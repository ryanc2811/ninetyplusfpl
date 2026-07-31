from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import FixtureSnapshot, Gameweek, PlayerSnapshot, RawSnapshot, Season, TeamSnapshot
from .providers import FplProvider, ProviderPayload
from .schemas import SnapshotSummary


POSITIONS = {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}


@dataclass(frozen=True)
class QualityThresholds:
    minimum_players: int = 300
    expected_teams: int = 20
    minimum_fixtures: int = 100


def _number(value: Any, fallback: float = 0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _parse_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def _optional_int(value: Any) -> Optional[int]:
    if value in (None, ""):
        return None
    return int(value)


def _per_90(player: dict[str, Any], per_90_key: str, total_key: str) -> float:
    direct = _number(player.get(per_90_key), -1)
    if direct >= 0:
        return direct
    minutes = _number(player.get("minutes"))
    return _number(player.get(total_key)) * 90 / minutes if minutes > 0 else 0


def _event_rates(player: dict[str, Any]) -> dict[str, float]:
    return {
        "expected_goals_per_90": _number(player.get("expected_goals_per_90")),
        "expected_assists_per_90": _number(player.get("expected_assists_per_90")),
        "clean_sheets_per_90": _number(player.get("clean_sheets_per_90")),
        "saves_per_90": _per_90(player, "saves_per_90", "saves"),
        "yellow_cards_per_90": _per_90(
            player, "yellow_cards_per_90", "yellow_cards"
        ),
        "bps_per_90": _per_90(player, "bps_per_90", "bps"),
        "bonus_per_90": _per_90(player, "bonus_per_90", "bonus"),
        "defensive_contribution_per_90": _number(
            player.get("defensive_contribution_per_90")
        ),
    }


def _refresh_event_rates(
    session: Session,
    snapshot: RawSnapshot,
    elements: list[dict[str, Any]],
) -> None:
    """Backfill columns added after a raw snapshot was originally normalized."""
    normalized = {
        player.source_id: player
        for player in session.scalars(
            select(PlayerSnapshot).where(PlayerSnapshot.snapshot_id == snapshot.id)
        )
    }
    for element in elements:
        player = normalized.get(int(element["id"]))
        if player is None:
            continue
        for key, value in _event_rates(element).items():
            setattr(player, key, value)
    session.commit()


def _canonical_payload(payload: ProviderPayload) -> dict[str, Any]:
    return {"bootstrap": payload.bootstrap, "fixtures": payload.fixtures}


def _checksum(raw_payload: dict[str, Any]) -> str:
    canonical = json.dumps(raw_payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _next_gameweek(events: list[dict[str, Any]]) -> int:
    next_event = next((event for event in events if event.get("is_next")), None)
    unfinished = next((event for event in events if not event.get("finished")), None)
    return int((next_event or unfinished or {"id": 1})["id"])


def validate_payload(payload: ProviderPayload, thresholds: QualityThresholds) -> list[str]:
    issues: list[str] = []
    players = payload.bootstrap.get("elements", [])
    teams = payload.bootstrap.get("teams", [])
    events = payload.bootstrap.get("events", [])
    team_ids = {team.get("id") for team in teams}

    if len(players) < thresholds.minimum_players:
        issues.append(f"expected at least {thresholds.minimum_players} players; received {len(players)}")
    if len(teams) != thresholds.expected_teams:
        issues.append(f"expected {thresholds.expected_teams} teams; received {len(teams)}")
    if len(payload.fixtures) < thresholds.minimum_fixtures:
        issues.append(f"expected at least {thresholds.minimum_fixtures} fixtures; received {len(payload.fixtures)}")
    if not events:
        issues.append("no Gameweeks supplied")
    invalid_player_teams = [player.get("id") for player in players if player.get("team") not in team_ids]
    if invalid_player_teams:
        issues.append(f"{len(invalid_player_teams)} players reference unknown teams")
    duplicate_player_ids = len(players) - len({player.get("id") for player in players})
    if duplicate_player_ids:
        issues.append(f"{duplicate_player_ids} duplicate player IDs")
    invalid_positions = [
        player.get("id") for player in players if int(player.get("element_type") or 0) not in POSITIONS
    ]
    if invalid_positions:
        issues.append(f"{len(invalid_positions)} players have unknown positions")
    return issues


def _counts(session: Session, snapshot_id: str) -> tuple[int, int, int]:
    player_count = session.scalar(select(func.count()).select_from(PlayerSnapshot).where(PlayerSnapshot.snapshot_id == snapshot_id)) or 0
    team_count = session.scalar(select(func.count()).select_from(TeamSnapshot).where(TeamSnapshot.snapshot_id == snapshot_id)) or 0
    fixture_count = session.scalar(select(func.count()).select_from(FixtureSnapshot).where(FixtureSnapshot.snapshot_id == snapshot_id)) or 0
    return player_count, team_count, fixture_count


def snapshot_summary(session: Session, snapshot: RawSnapshot, created: bool) -> SnapshotSummary:
    player_count, team_count, fixture_count = _counts(session, snapshot.id)
    return SnapshotSummary(
        id=snapshot.id,
        source=snapshot.source,
        retrieved_at=snapshot.retrieved_at,
        season_id=snapshot.season_id,
        gameweek=snapshot.gameweek,
        checksum=snapshot.checksum,
        schema_version=snapshot.schema_version,
        ingestion_status=snapshot.ingestion_status,
        player_count=player_count,
        team_count=team_count,
        fixture_count=fixture_count,
        created=created,
    )


def ingest_current_snapshot(
    session: Session,
    provider: FplProvider,
    season_name: str,
    thresholds: QualityThresholds = QualityThresholds(),
) -> SnapshotSummary:
    payload = provider.fetch()
    issues = validate_payload(payload, thresholds)
    if issues:
        raise ValueError("; ".join(issues))

    raw_payload = _canonical_payload(payload)
    checksum = _checksum(raw_payload)
    existing = session.scalar(
        select(RawSnapshot).where(RawSnapshot.source == payload.source, RawSnapshot.checksum == checksum)
    )
    if existing:
        _refresh_event_rates(session, existing, payload.bootstrap["elements"])
        return snapshot_summary(session, existing, created=False)

    season_id = season_name.replace("/", "-")
    season = session.get(Season, season_id)
    if not season:
        season = Season(
            id=season_id,
            name=season_name,
            start_year=int(season_name.split("/")[0]),
            rules_version=f"fpl-{season_id}-v1",
            created_at=datetime.now(timezone.utc),
        )
        session.add(season)
        session.flush()

    events = payload.bootstrap["events"]
    gameweek = _next_gameweek(events)
    for event in events:
        number = int(event["id"])
        existing_gameweek = session.scalar(
            select(Gameweek).where(Gameweek.season_id == season_id, Gameweek.number == number)
        )
        if not existing_gameweek:
            session.add(
                Gameweek(
                    season_id=season_id,
                    number=number,
                    deadline_time=_parse_datetime(event.get("deadline_time")),
                    is_finished=bool(event.get("finished", False)),
                )
            )

    snapshot = RawSnapshot(
        id=str(uuid.uuid4()),
        source=payload.source,
        retrieved_at=payload.retrieved_at,
        season_id=season_id,
        gameweek=gameweek,
        request_parameters=payload.request_parameters,
        source_event_timestamp=payload.source_event_timestamp,
        checksum=checksum,
        schema_version="official-fpl-v1",
        ingestion_status="succeeded",
        raw_payload=raw_payload,
    )
    session.add(snapshot)
    session.flush()

    session.add_all(
        TeamSnapshot(
            snapshot_id=snapshot.id,
            source_id=int(team["id"]),
            name=str(team["name"]),
            short_name=str(team["short_name"]),
            strength=int(team.get("strength") or 0),
        )
        for team in payload.bootstrap["teams"]
    )
    session.add_all(
        PlayerSnapshot(
            snapshot_id=snapshot.id,
            source_id=int(player["id"]),
            team_source_id=int(player["team"]),
            web_name=str(player["web_name"]),
            first_name=str(player.get("first_name") or ""),
            second_name=str(player.get("second_name") or ""),
            position=POSITIONS[int(player["element_type"])],
            price=_number(player.get("now_cost")) / 10,
            status=str(player.get("status") or "a"),
            chance_next_round=_optional_int(player.get("chance_of_playing_next_round")),
            minutes=int(_number(player.get("minutes"))),
            starts=int(_number(player.get("starts"))),
            total_points=int(_number(player.get("total_points"))),
            form=_number(player.get("form")),
            selected_by_percent=_number(player.get("selected_by_percent")),
            **_event_rates(player),
        )
        for player in payload.bootstrap["elements"]
    )
    session.add_all(
        FixtureSnapshot(
            snapshot_id=snapshot.id,
            source_id=int(fixture["id"]),
            event=fixture.get("event"),
            home_team_source_id=int(fixture["team_h"]),
            away_team_source_id=int(fixture["team_a"]),
            home_difficulty=int(fixture.get("team_h_difficulty") or 3),
            away_difficulty=int(fixture.get("team_a_difficulty") or 3),
            kickoff_time=_parse_datetime(fixture.get("kickoff_time")),
            started=bool(fixture.get("started", False)),
            finished=bool(fixture.get("finished", False)),
        )
        for fixture in payload.fixtures
    )
    session.commit()
    return snapshot_summary(session, snapshot, created=True)
