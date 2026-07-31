from __future__ import annotations

import uuid
from datetime import datetime, timezone

import numpy as np
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from .fpl_rules import RULES_2026_27, RULES_VERSION, allocate_bonus_points
from .models import (
    ExpectedMinutesForecast,
    FixtureSnapshot,
    MatchForecast,
    PlayerPointsForecast,
    PlayerSnapshot,
    RawSnapshot,
)
from .player_events import latest_player_event_model


MODEL_VERSION = "correlated-player-points-monte-carlo-v1"


class PointsSimulationError(ValueError):
    pass


def _latest_snapshot(session: Session) -> RawSnapshot:
    snapshot = session.scalar(
        select(RawSnapshot)
        .where(RawSnapshot.ingestion_status == "succeeded")
        .order_by(desc(RawSnapshot.retrieved_at))
        .limit(1)
    )
    if not snapshot:
        raise PointsSimulationError("No successful snapshot is available")
    return snapshot


def _latest_rows(session: Session, model, snapshot_id: str):
    generated_at = session.scalar(
        select(model.generated_at)
        .where(model.snapshot_id == snapshot_id)
        .order_by(desc(model.generated_at))
        .limit(1)
    )
    if generated_at is None:
        return []
    return list(
        session.scalars(
            select(model).where(
                model.snapshot_id == snapshot_id,
                model.generated_at == generated_at,
            )
        )
    )


def _fallback_rate(position: str, kind: str, price: float) -> float:
    price_factor = min(1.7, max(0.75, 1 + (price - 5) * 0.06))
    priors = {
        "goals": {"GK": 0.001, "DEF": 0.035, "MID": 0.12, "FWD": 0.2},
        "assists": {"GK": 0.002, "DEF": 0.07, "MID": 0.13, "FWD": 0.1},
        "defcon": {"GK": 0.0, "DEF": 7.8, "MID": 7.0, "FWD": 3.5},
        "saves": {"GK": 3.0, "DEF": 0.0, "MID": 0.0, "FWD": 0.0},
        "yellow": {"GK": 0.06, "DEF": 0.16, "MID": 0.15, "FWD": 0.1},
        "bps": {"GK": 13.0, "DEF": 12.0, "MID": 11.0, "FWD": 10.0},
    }
    value = priors[kind][position]
    return value * price_factor if kind in {"goals", "assists"} else value


def _rate(
    player: PlayerSnapshot,
    attr: str,
    kind: str,
    calibrated_rates: dict[str, float] | None = None,
) -> float:
    value = float(getattr(player, attr) or 0)
    calibrated = float((calibrated_rates or {}).get(kind, 0))
    if value > 0 and calibrated > 0:
        return value * 0.65 + calibrated * 0.35
    if value > 0:
        return value
    if calibrated > 0:
        return calibrated
    return _fallback_rate(player.position, kind, player.price)


def _sample_minutes(
    rng: np.random.Generator,
    forecast: ExpectedMinutesForecast,
    simulations: int,
) -> np.ndarray:
    roll = rng.random(simulations)
    start = roll < forecast.start_probability
    substitute = (roll >= forecast.start_probability) & (
        roll < forecast.start_probability + forecast.substitute_probability
    )
    minutes = np.zeros(simulations, dtype=np.int16)
    start_count = int(start.sum())
    substitute_count = int(substitute.sum())
    if start_count:
        minutes[start] = np.rint(
            np.clip(
                rng.normal(forecast.expected_minutes_if_start, 8, start_count),
                1,
                90,
            )
        ).astype(np.int16)
    if substitute_count:
        minutes[substitute] = np.rint(
            np.clip(
                rng.normal(forecast.expected_minutes_if_substitute, 7, substitute_count),
                1,
                45,
            )
        ).astype(np.int16)
    return minutes


def _allocate_team_events(
    rng: np.random.Generator,
    totals: np.ndarray,
    minutes: np.ndarray,
    rates: np.ndarray,
    probability: float = 1.0,
) -> np.ndarray:
    player_count, simulations = minutes.shape
    events = np.zeros((player_count, simulations), dtype=np.int16)
    for simulation in range(simulations):
        weights = rates * minutes[:, simulation]
        weight_sum = float(weights.sum())
        if weight_sum <= 0:
            continue
        probabilities = weights / weight_sum
        for _ in range(int(totals[simulation])):
            if rng.random() <= probability:
                events[rng.choice(player_count, p=probabilities), simulation] += 1
    return events


def _simulate_fixture(
    rng: np.random.Generator,
    fixture: FixtureSnapshot,
    match: MatchForecast,
    home_players: list[PlayerSnapshot],
    away_players: list[PlayerSnapshot],
    minutes_by_player: dict[int, ExpectedMinutesForecast],
    calibrated_rates_by_player: dict[int, dict[str, float]],
    simulations: int,
) -> dict[int, dict[str, np.ndarray]]:
    players = home_players + away_players
    home_count = len(home_players)
    minutes = np.vstack(
        [_sample_minutes(rng, minutes_by_player[player.source_id], simulations) for player in players]
    )
    home_goals = rng.poisson(match.expected_home_goals, simulations)
    away_goals = rng.poisson(match.expected_away_goals, simulations)

    goal_rates = np.array(
        [
            _rate(
                player,
                "expected_goals_per_90",
                "goals",
                calibrated_rates_by_player.get(player.source_id),
            )
            for player in players
        ]
    )
    assist_rates = np.array(
        [
            _rate(
                player,
                "expected_assists_per_90",
                "assists",
                calibrated_rates_by_player.get(player.source_id),
            )
            for player in players
        ]
    )
    goals = np.vstack(
        (
            _allocate_team_events(
                rng, home_goals, minutes[:home_count], goal_rates[:home_count]
            ),
            _allocate_team_events(
                rng, away_goals, minutes[home_count:], goal_rates[home_count:]
            ),
        )
    )
    assists = np.vstack(
        (
            _allocate_team_events(
                rng, home_goals, minutes[:home_count], assist_rates[:home_count], 0.72
            ),
            _allocate_team_events(
                rng, away_goals, minutes[home_count:], assist_rates[home_count:], 0.72
            ),
        )
    )

    points = np.zeros_like(minutes, dtype=np.int16)
    bonus = np.zeros_like(minutes, dtype=np.int8)
    defcon_points = np.zeros_like(minutes, dtype=np.int8)
    clean_sheets = np.zeros_like(minutes, dtype=bool)
    defensive_actions = np.zeros_like(minutes, dtype=np.int16)
    saves = np.zeros_like(minutes, dtype=np.int16)
    yellows = np.zeros_like(minutes, dtype=np.int8)
    bps = np.zeros_like(minutes, dtype=float)

    for index, player in enumerate(players):
        appeared = minutes[index] > 0
        reached_sixty = minutes[index] >= 60
        conceded = away_goals if index < home_count else home_goals
        clean_sheets[index] = reached_sixty & (conceded == 0)
        calibrated_rates = calibrated_rates_by_player.get(player.source_id)
        defcon_rate = _rate(
            player,
            "defensive_contribution_per_90",
            "defcon",
            calibrated_rates,
        )
        defensive_actions[index] = rng.poisson(
            defcon_rate * minutes[index] / 90
        )
        threshold = RULES_2026_27.defensive_contribution_threshold(player.position)
        earned_defcon = defensive_actions[index] >= threshold
        defcon_points[index] = (
            earned_defcon.astype(np.int8)
            * RULES_2026_27.defensive_contribution_points
        )
        yellow_rate = _rate(
            player,
            "yellow_cards_per_90",
            "yellow",
            calibrated_rates,
        )
        yellows[index] = (
            rng.poisson(yellow_rate * minutes[index] / 90) > 0
        ).astype(np.int8)
        if player.position == "GK":
            save_rate = _rate(
                player,
                "saves_per_90",
                "saves",
                calibrated_rates,
            )
            saves[index] = rng.poisson(save_rate * minutes[index] / 90)

        appearance_points = appeared.astype(np.int16) + reached_sixty.astype(np.int16)
        points[index] = (
            appearance_points
            + goals[index] * RULES_2026_27.goal_points(player.position)
            + assists[index] * RULES_2026_27.assist
            + clean_sheets[index].astype(np.int16)
            * RULES_2026_27.clean_sheet_points(player.position)
            + (saves[index] // RULES_2026_27.saves_per_point)
            + defcon_points[index]
            + yellows[index] * RULES_2026_27.yellow_card
        )
        if player.position in {"GK", "DEF"}:
            points[index] -= reached_sixty.astype(np.int16) * (
                conceded // RULES_2026_27.goals_conceded_per_deduction
            )

        base_bps = (
            _rate(player, "bps_per_90", "bps", calibrated_rates)
            * minutes[index]
            / 90
            * 0.25
        )
        bps[index] = (
            base_bps
            + appeared * 3
            + reached_sixty * 3
            + goals[index] * {"GK": 12, "DEF": 12, "MID": 18, "FWD": 24}[player.position]
            + assists[index] * 9
            + clean_sheets[index] * (12 if player.position in {"GK", "DEF"} else 6)
            + saves[index] * 2
            + np.floor(defensive_actions[index] / 3)
            - yellows[index] * 3
        )

    for simulation in range(simulations):
        awarded = allocate_bonus_points(
            bps[:, simulation].tolist(),
            (minutes[:, simulation] > 0).tolist(),
        )
        bonus[:, simulation] = np.array(awarded, dtype=np.int8)
    points += bonus

    return {
        player.source_id: {
            "points": points[index],
            "goals": goals[index],
            "assists": assists[index],
            "clean_sheets": clean_sheets[index],
            "bonus": bonus[index],
            "defcon_points": defcon_points[index],
            "minutes": minutes[index],
        }
        for index, player in enumerate(players)
    }


def generate_player_points_forecasts(
    session: Session,
    simulations: int = 2000,
    seed: int = 2627,
    horizon: int = 3,
) -> list[PlayerPointsForecast]:
    if simulations < 100 or simulations > 25000:
        raise PointsSimulationError("simulations must be between 100 and 25,000")
    if horizon < 1 or horizon > 3:
        raise PointsSimulationError("horizon must be between one and three Gameweeks")

    snapshot = _latest_snapshot(session)
    expected_minutes = _latest_rows(session, ExpectedMinutesForecast, snapshot.id)
    matches = _latest_rows(session, MatchForecast, snapshot.id)
    if not expected_minutes:
        raise PointsSimulationError("Generate expected-minutes forecasts first")
    if not matches:
        raise PointsSimulationError("Generate match forecasts first")

    minutes_by_player = {row.player_source_id: row for row in expected_minutes}
    match_by_fixture = {row.fixture_source_id: row for row in matches}
    players = list(
        session.scalars(
            select(PlayerSnapshot).where(PlayerSnapshot.snapshot_id == snapshot.id)
        )
    )
    players_by_team: dict[int, list[PlayerSnapshot]] = {}
    for player in players:
        if player.source_id in minutes_by_player:
            players_by_team.setdefault(player.team_source_id, []).append(player)

    event_model = latest_player_event_model(session)
    calibrated_rates_by_player: dict[int, dict[str, float]] = {}
    if event_model:
        player_rates = event_model.artifact.get("playerRates", {})
        position_rates = event_model.artifact.get("positionRates", {})
        players_by_source = {player.source_id: player for player in players}
        for player_source_id, minutes_forecast in minutes_by_player.items():
            player = players_by_source.get(player_source_id)
            if not player:
                continue
            identity_rates = player_rates.get(minutes_forecast.player_identity_id or "")
            calibrated_rates_by_player[player_source_id] = (
                identity_rates["rates"]
                if identity_rates
                else position_rates.get(player.position, {})
            )

    fixtures = list(
        session.scalars(
            select(FixtureSnapshot)
            .where(
                FixtureSnapshot.snapshot_id == snapshot.id,
                FixtureSnapshot.finished.is_(False),
                FixtureSnapshot.event.is_not(None),
                FixtureSnapshot.event >= snapshot.gameweek,
                FixtureSnapshot.event < snapshot.gameweek + horizon,
            )
            .order_by(FixtureSnapshot.event, FixtureSnapshot.kickoff_time)
        )
    )
    usable = [
        fixture
        for fixture in fixtures
        if fixture.source_id in match_by_fixture
        and players_by_team.get(fixture.home_team_source_id)
        and players_by_team.get(fixture.away_team_source_id)
    ]
    if not usable:
        raise PointsSimulationError("No forecast fixtures have complete player and match inputs")

    rng = np.random.default_rng(seed)
    simulation_id = str(uuid.uuid4())
    generated_at = datetime.now(timezone.utc)
    forecasts: list[PlayerPointsForecast] = []
    expected_minutes_run_ids = sorted({row.model_run_id for row in expected_minutes})
    match_run_ids = sorted({row.model_run_id for row in matches})

    for fixture in usable:
        home_players = players_by_team[fixture.home_team_source_id]
        away_players = players_by_team[fixture.away_team_source_id]
        outcomes = _simulate_fixture(
            rng,
            fixture,
            match_by_fixture[fixture.source_id],
            home_players,
            away_players,
            minutes_by_player,
            calibrated_rates_by_player,
            simulations,
        )
        for player in home_players + away_players:
            outcome = outcomes[player.source_id]
            points = outcome["points"]
            minutes_forecast = minutes_by_player[player.source_id]
            calibrated_rates = calibrated_rates_by_player.get(player.source_id)
            forecast = PlayerPointsForecast(
                simulation_id=simulation_id,
                snapshot_id=snapshot.id,
                fixture_source_id=fixture.source_id,
                event=int(fixture.event),
                player_source_id=player.source_id,
                generated_at=generated_at,
                model_version=MODEL_VERSION,
                rules_version=RULES_VERSION,
                simulation_count=simulations,
                seed=seed,
                expected_points=round(float(np.mean(points)), 3),
                median_points=round(float(np.median(points)), 3),
                p10_points=round(float(np.quantile(points, 0.1)), 3),
                p90_points=round(float(np.quantile(points, 0.9)), 3),
                two_plus_probability=float(np.mean(points >= 2)),
                five_plus_probability=float(np.mean(points >= 5)),
                ten_plus_probability=float(np.mean(points >= 10)),
                fifteen_plus_probability=float(np.mean(points >= 15)),
                goal_probability=float(np.mean(outcome["goals"] > 0)),
                assist_probability=float(np.mean(outcome["assists"] > 0)),
                clean_sheet_probability=float(np.mean(outcome["clean_sheets"])),
                bonus_probability=float(np.mean(outcome["bonus"] > 0)),
                defensive_contribution_probability=float(
                    np.mean(outcome["defcon_points"] > 0)
                ),
                expected_bonus=float(np.mean(outcome["bonus"])),
                expected_defensive_contribution_points=float(
                    np.mean(outcome["defcon_points"])
                ),
                confidence=round(
                    min(
                        0.95,
                        max(
                            0.2,
                            minutes_forecast.confidence * 0.6
                            + match_by_fixture[fixture.source_id].confidence * 0.4,
                        ),
                    ),
                    3,
                ),
                event_priors={
                    "goalsPer90": round(
                        _rate(
                            player,
                            "expected_goals_per_90",
                            "goals",
                            calibrated_rates,
                        ),
                        4,
                    ),
                    "assistsPer90": round(
                        _rate(
                            player,
                            "expected_assists_per_90",
                            "assists",
                            calibrated_rates,
                        ),
                        4,
                    ),
                    "defensiveContributionsPer90": round(
                        _rate(
                            player,
                            "defensive_contribution_per_90",
                            "defcon",
                            calibrated_rates,
                        ),
                        4,
                    ),
                    "bpsPer90": round(
                        _rate(player, "bps_per_90", "bps", calibrated_rates),
                        4,
                    ),
                    "source": (
                        "trained-player-or-position-prior"
                        if calibrated_rates
                        else "public-rate-or-position-fallback"
                    ),
                },
                lineage={
                    "expectedMinutesModelRunIds": expected_minutes_run_ids,
                    "teamModelRunIds": match_run_ids,
                    "snapshotChecksum": snapshot.checksum,
                    "bpsMethod": "match-ranked-proxy-v1",
                    "eventModelRunId": event_model.id if event_model else None,
                    "eventModelVersion": (
                        event_model.model_version if event_model else None
                    ),
                },
                reasons=[
                    "Minutes sampled from calibrated start, substitute and zero-minute states",
                    "Goals and assists allocated within a shared simulated match scoreline",
                    "2026/27 defensive-contribution threshold and match-ranked bonus applied",
                    "Bonus uses a transparent BPS proxy until granular Opta event inputs are licensed",
                    (
                        "Goal, assist, save, card, BPS and defensive-action priors use a locked historical event model"
                        if event_model
                        else "Player-event training is unavailable; transparent public and position priors are used"
                    ),
                ],
            )
            session.add(forecast)
            forecasts.append(forecast)
    session.commit()
    return forecasts
