from __future__ import annotations

import csv
import hashlib
import io
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from .identity import resolve_historical_identity
from .models import HistoricalDataset, PlayerGameweekObservation, TeamMatchObservation


POSITION_ALIASES = {
    "GK": "GK",
    "GKP": "GK",
    "GOALKEEPER": "GK",
    "DEF": "DEF",
    "DEFENDER": "DEF",
    "MID": "MID",
    "MIDFIELDER": "MID",
    "FWD": "FWD",
    "FORWARD": "FWD",
}


@dataclass(frozen=True)
class HistoricalImportResult:
    dataset_id: str
    checksum: str
    row_count: int
    created: bool
    inferred_start_count: int


class HistoricalDataError(ValueError):
    pass


def _pick(row: dict[str, str], *names: str, default: str = "") -> str:
    for name in names:
        if row.get(name) not in (None, ""):
            return str(row[name])
    return default


def _integer(value: str, field: str) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError) as error:
        raise HistoricalDataError(f"invalid {field}: {value!r}") from error


def _boolean(value: str) -> bool:
    return str(value).strip().lower() in {"1", "true", "t", "yes", "y"}


def _timestamp(value: str) -> datetime:
    if not value:
        raise HistoricalDataError("kickoff_time is required for temporal validation")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _row_checksum(values: dict[str, Any]) -> str:
    encoded = json.dumps(values, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _refresh_existing_player_events(
    session: Session,
    dataset: HistoricalDataset,
    csv_text: str,
) -> None:
    """Backfill event columns when a v1 dataset is re-imported after migration 0006."""
    observations = {
        (row.player_source_id, row.fixture_source_id): row
        for row in session.scalars(
            select(PlayerGameweekObservation).where(
                PlayerGameweekObservation.dataset_id == dataset.id
            )
        )
    }
    for row in csv.DictReader(io.StringIO(csv_text)):
        player_id = _integer(_pick(row, "player_id", "element"), "player_id")
        fixture_id = _integer(_pick(row, "fixture_id", "fixture"), "fixture_id")
        observation = observations.get((player_id, fixture_id))
        if observation is None:
            continue
        values = {
            "goals_scored": _integer(
                _pick(row, "goals_scored", "goals", default="0"),
                "goals_scored",
            ),
            "assists": _integer(_pick(row, "assists", default="0"), "assists"),
            "clean_sheets": _integer(
                _pick(row, "clean_sheets", "clean_sheet", default="0"),
                "clean_sheets",
            ),
            "saves": _integer(_pick(row, "saves", default="0"), "saves"),
            "yellow_cards": _integer(
                _pick(row, "yellow_cards", default="0"), "yellow_cards"
            ),
            "bonus": _integer(_pick(row, "bonus", default="0"), "bonus"),
            "bps": _integer(_pick(row, "bps", default="0"), "bps"),
            "defensive_contributions": _integer(
                _pick(
                    row,
                    "defensive_contributions",
                    "defensive_contribution",
                    "defcon",
                    default="0",
                ),
                "defensive_contributions",
            ),
        }
        for field, value in values.items():
            setattr(observation, field, value)
    dataset.schema_version = "player-gameweek-csv-v2"
    session.commit()


def import_historical_csv_text(
    session: Session,
    csv_text: str,
    *,
    source: str,
    source_uri: str,
    season_id: str,
    license_status: str,
    retrieved_at: Optional[datetime] = None,
) -> HistoricalImportResult:
    if license_status not in {"licensed", "confirmed-open", "development-only"}:
        raise HistoricalDataError("license_status must be licensed, confirmed-open, or development-only")
    checksum = hashlib.sha256(csv_text.encode("utf-8")).hexdigest()
    existing = session.scalar(
        select(HistoricalDataset).where(
            HistoricalDataset.source == source,
            HistoricalDataset.checksum == checksum,
        )
    )
    if existing:
        _refresh_existing_player_events(session, existing, csv_text)
        inferred = session.query(PlayerGameweekObservation).filter(
            PlayerGameweekObservation.dataset_id == existing.id,
            PlayerGameweekObservation.start_inferred.is_(True),
        ).count()
        return HistoricalImportResult(existing.id, checksum, existing.row_count, False, inferred)

    reader = csv.DictReader(io.StringIO(csv_text))
    if not reader.fieldnames:
        raise HistoricalDataError("historical CSV has no header")

    parsed_rows: list[dict[str, Any]] = []
    inferred_start_count = 0
    for line_number, row in enumerate(reader, start=2):
        minutes = _integer(_pick(row, "minutes"), "minutes")
        if minutes < 0 or minutes > 120:
            raise HistoricalDataError(f"line {line_number}: minutes outside 0-120")
        started_value = _pick(row, "started", "starts")
        start_inferred = started_value == ""
        started = _boolean(started_value) if started_value else minutes >= 45
        inferred_start_count += int(start_inferred)
        raw_position = _pick(row, "position", default="").upper()
        position = POSITION_ALIASES.get(raw_position)
        if not position:
            raise HistoricalDataError(f"line {line_number}: unknown position {raw_position!r}")

        values = {
            "season_id": season_id,
            "gameweek": _integer(_pick(row, "gameweek", "GW", "round"), "gameweek"),
            "player_source_id": _integer(_pick(row, "player_id", "element"), "player_id"),
            "player_name": _pick(row, "player_name", "name", default="Unknown"),
            "position": position,
            "team_name": _pick(row, "team_name", "team", default="Unknown"),
            "opponent_name": _pick(row, "opponent_name", "opponent_team", default="Unknown"),
            "fixture_source_id": _integer(_pick(row, "fixture_id", "fixture"), "fixture_id"),
            "kickoff_time": _timestamp(_pick(row, "kickoff_time")),
            "was_home": _boolean(_pick(row, "was_home", default="false")),
            "difficulty": _integer(_pick(row, "difficulty", default="3"), "difficulty"),
            "minutes": minutes,
            "started": started,
            "start_inferred": start_inferred,
            "total_points": _integer(_pick(row, "total_points", "points", default="0"), "total_points"),
            "goals_scored": _integer(
                _pick(row, "goals_scored", "goals", default="0"),
                "goals_scored",
            ),
            "assists": _integer(_pick(row, "assists", default="0"), "assists"),
            "clean_sheets": _integer(
                _pick(row, "clean_sheets", "clean_sheet", default="0"),
                "clean_sheets",
            ),
            "saves": _integer(_pick(row, "saves", default="0"), "saves"),
            "yellow_cards": _integer(
                _pick(row, "yellow_cards", default="0"),
                "yellow_cards",
            ),
            "bonus": _integer(_pick(row, "bonus", default="0"), "bonus"),
            "bps": _integer(_pick(row, "bps", default="0"), "bps"),
            "defensive_contributions": _integer(
                _pick(
                    row,
                    "defensive_contributions",
                    "defensive_contribution",
                    "defcon",
                    default="0",
                ),
                "defensive_contributions",
            ),
        }
        for field in (
            "goals_scored",
            "assists",
            "clean_sheets",
            "saves",
            "yellow_cards",
            "bonus",
            "defensive_contributions",
        ):
            if values[field] < 0:
                raise HistoricalDataError(
                    f"line {line_number}: {field} cannot be negative"
                )
        values["row_checksum"] = _row_checksum(values)
        parsed_rows.append(values)

    if not parsed_rows:
        raise HistoricalDataError("historical CSV contains no observations")
    unique_rows = {row["row_checksum"] for row in parsed_rows}
    if len(unique_rows) != len(parsed_rows):
        raise HistoricalDataError("historical CSV contains duplicate observations")

    dataset = HistoricalDataset(
        id=str(uuid.uuid4()),
        source=source,
        source_uri=source_uri,
        retrieved_at=retrieved_at or datetime.now(timezone.utc),
        season_id=season_id,
        checksum=checksum,
        schema_version="player-gameweek-csv-v2",
        license_status=license_status,
        row_count=len(parsed_rows),
    )
    session.add(dataset)
    session.flush()
    identity_cache: dict[tuple[int, str, str], Optional[str]] = {}
    for values in parsed_rows:
        identity_key = (
            values["player_source_id"],
            values["player_name"],
            values["position"],
        )
        if identity_key not in identity_cache:
            resolution = resolve_historical_identity(
                session,
                source=source,
                season_id=season_id,
                source_player_id=values["player_source_id"],
                source_name=values["player_name"],
                position=values["position"],
            )
            identity_cache[identity_key] = resolution.player_identity_id
        values["player_identity_id"] = identity_cache[identity_key]
    session.add_all(
        PlayerGameweekObservation(dataset_id=dataset.id, **values)
        for values in parsed_rows
    )
    session.commit()
    return HistoricalImportResult(
        dataset.id,
        checksum,
        len(parsed_rows),
        True,
        inferred_start_count,
    )


def import_historical_csv_path(
    session: Session,
    path: Path,
    *,
    source: str,
    season_id: str,
    license_status: str,
) -> HistoricalImportResult:
    return import_historical_csv_text(
        session,
        path.read_text(encoding="utf-8"),
        source=source,
        source_uri=str(path.resolve()),
        season_id=season_id,
        license_status=license_status,
    )


def import_team_match_csv_text(
    session: Session,
    csv_text: str,
    *,
    source: str,
    source_uri: str,
    season_id: str,
    license_status: str,
    retrieved_at: Optional[datetime] = None,
) -> HistoricalImportResult:
    if license_status not in {"licensed", "confirmed-open", "development-only"}:
        raise HistoricalDataError("license_status must be licensed, confirmed-open, or development-only")
    checksum = hashlib.sha256(csv_text.encode("utf-8")).hexdigest()
    existing = session.scalar(
        select(HistoricalDataset).where(
            HistoricalDataset.source == source,
            HistoricalDataset.checksum == checksum,
        )
    )
    if existing:
        return HistoricalImportResult(existing.id, checksum, existing.row_count, False, 0)

    reader = csv.DictReader(io.StringIO(csv_text))
    if not reader.fieldnames:
        raise HistoricalDataError("team-match CSV has no header")
    parsed_rows: list[dict[str, Any]] = []
    for line_number, row in enumerate(reader, start=2):
        home_team = _pick(row, "home_team", "team_h", "HomeTeam").strip()
        away_team = _pick(row, "away_team", "team_a", "AwayTeam").strip()
        if not home_team or not away_team or home_team == away_team:
            raise HistoricalDataError(f"line {line_number}: invalid home/away teams")
        home_goals = _integer(
            _pick(row, "home_goals", "team_h_score", "FTHG"),
            "home_goals",
        )
        away_goals = _integer(
            _pick(row, "away_goals", "team_a_score", "FTAG"),
            "away_goals",
        )
        if not 0 <= home_goals <= 20 or not 0 <= away_goals <= 20:
            raise HistoricalDataError(f"line {line_number}: goals outside 0-20")
        home_xg = _pick(row, "home_expected_goals", "home_xg")
        away_xg = _pick(row, "away_expected_goals", "away_xg")
        values = {
            "season_id": season_id,
            "gameweek": _integer(_pick(row, "gameweek", "GW", "round"), "gameweek"),
            "fixture_source_id": _integer(
                _pick(row, "fixture_id", "fixture", "id"),
                "fixture_id",
            ),
            "kickoff_time": _timestamp(_pick(row, "kickoff_time", "date")),
            "home_team": home_team,
            "away_team": away_team,
            "home_goals": home_goals,
            "away_goals": away_goals,
            "home_expected_goals": float(home_xg) if home_xg else None,
            "away_expected_goals": float(away_xg) if away_xg else None,
        }
        values["row_checksum"] = _row_checksum(values)
        parsed_rows.append(values)
    if not parsed_rows:
        raise HistoricalDataError("team-match CSV contains no observations")
    if len({row["row_checksum"] for row in parsed_rows}) != len(parsed_rows):
        raise HistoricalDataError("team-match CSV contains duplicate observations")

    dataset = HistoricalDataset(
        id=str(uuid.uuid4()),
        source=source,
        source_uri=source_uri,
        retrieved_at=retrieved_at or datetime.now(timezone.utc),
        season_id=season_id,
        checksum=checksum,
        schema_version="team-match-csv-v1",
        license_status=license_status,
        row_count=len(parsed_rows),
    )
    session.add(dataset)
    session.flush()
    session.add_all(
        TeamMatchObservation(dataset_id=dataset.id, **values)
        for values in parsed_rows
    )
    session.commit()
    return HistoricalImportResult(dataset.id, checksum, len(parsed_rows), True, 0)


def import_team_match_csv_path(
    session: Session,
    path: Path,
    *,
    source: str,
    season_id: str,
    license_status: str,
) -> HistoricalImportResult:
    return import_team_match_csv_text(
        session,
        path.read_text(encoding="utf-8"),
        source=source,
        source_uri=str(path.resolve()),
        season_id=season_id,
        license_status=license_status,
    )
