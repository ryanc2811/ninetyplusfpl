from __future__ import annotations

import math
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from .models import (
    BacktestReport,
    HistoricalDataset,
    ModelRun,
    PlayerGameweekObservation,
)


MODEL_TYPE = "player-events"
MODEL_VERSION = "shrunk-player-position-poisson-v1"
BASELINE_VERSION = "position-poisson-v1"
RATE_FIELDS = {
    "goals": "goals_scored",
    "assists": "assists",
    "saves": "saves",
    "yellow": "yellow_cards",
    "bonus": "bonus",
    "bps": "bps",
    "defcon": "defensive_contributions",
}
PROBABILITY_EVENTS = ("goals", "assists", "yellow", "bonus", "defcon")


class PlayerEventModelError(ValueError):
    pass


def _identity_key(observation: PlayerGameweekObservation) -> str:
    return observation.player_identity_id or (
        f"source:{observation.season_id}:{observation.player_source_id}"
    )


def _time_key(observation: PlayerGameweekObservation) -> tuple[str, int]:
    return observation.season_id, observation.gameweek


def _datasets_and_observations(
    session: Session,
    dataset_ids: list[str],
) -> tuple[list[HistoricalDataset], list[PlayerGameweekObservation]]:
    if not dataset_ids:
        raise PlayerEventModelError("at least one historical dataset is required")
    datasets = list(
        session.scalars(
            select(HistoricalDataset).where(HistoricalDataset.id.in_(dataset_ids))
        )
    )
    if len(datasets) != len(set(dataset_ids)):
        raise PlayerEventModelError("one or more historical datasets do not exist")
    observations = list(
        session.scalars(
            select(PlayerGameweekObservation)
            .where(PlayerGameweekObservation.dataset_id.in_(dataset_ids))
            .order_by(
                PlayerGameweekObservation.kickoff_time,
                PlayerGameweekObservation.fixture_source_id,
            )
        )
    )
    if not observations:
        raise PlayerEventModelError(
            "selected datasets contain no player-event observations"
        )
    return datasets, observations


def _aggregate_rates(
    observations: list[PlayerGameweekObservation],
    key_function,
) -> dict[str, dict[str, Any]]:
    aggregates: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "minutes": 0.0,
            "matches": 0,
            "position": "",
            **{kind: 0.0 for kind in RATE_FIELDS},
        }
    )
    for observation in observations:
        key = str(key_function(observation))
        aggregate = aggregates[key]
        aggregate["minutes"] += observation.minutes
        aggregate["matches"] += 1
        aggregate["position"] = observation.position
        for kind, field in RATE_FIELDS.items():
            aggregate[kind] += float(getattr(observation, field) or 0)
    return dict(aggregates)


def _fit_artifact(
    observations: list[PlayerGameweekObservation],
    *,
    player_shrink_minutes: float = 900,
    include_players: bool = True,
) -> dict[str, Any]:
    positions = _aggregate_rates(observations, lambda row: row.position)
    position_rates: dict[str, dict[str, float]] = {}
    for position in ("GK", "DEF", "MID", "FWD"):
        aggregate = positions.get(position)
        minutes = float(aggregate["minutes"]) if aggregate else 0
        position_rates[position] = {
            kind: (
                float(aggregate[kind]) * 90 / minutes
                if aggregate and minutes > 0
                else 0.0
            )
            for kind in RATE_FIELDS
        }

    player_rates: dict[str, dict[str, Any]] = {}
    if include_players:
        players = _aggregate_rates(observations, _identity_key)
        for identity, aggregate in players.items():
            minutes = float(aggregate["minutes"])
            position = str(aggregate["position"])
            priors = position_rates[position]
            player_rates[identity] = {
                "position": position,
                "minutes": round(minutes, 1),
                "matches": int(aggregate["matches"]),
                "rates": {
                    kind: round(
                        (
                            float(aggregate[kind])
                            + priors[kind] * player_shrink_minutes / 90
                        )
                        * 90
                        / (minutes + player_shrink_minutes),
                        6,
                    )
                    for kind in RATE_FIELDS
                },
            }

    return {
        "version": MODEL_VERSION if include_players else BASELINE_VERSION,
        "playerShrinkMinutes": player_shrink_minutes,
        "positionRates": position_rates,
        "playerRates": player_rates,
        "rateUnit": "events per 90 minutes",
    }


def _poisson_tail(rate: float, threshold: int) -> float:
    if threshold <= 0:
        return 1.0
    if rate <= 0:
        return 0.0
    cumulative = sum(
        math.exp(-rate) * rate**count / math.factorial(count)
        for count in range(threshold)
    )
    return min(1.0, max(0.0, 1 - cumulative))


def _rates_for(
    artifact: dict[str, Any],
    observation: PlayerGameweekObservation,
) -> dict[str, float]:
    player = artifact["playerRates"].get(_identity_key(observation))
    if player:
        return player["rates"]
    return artifact["positionRates"].get(
        observation.position,
        {kind: 0.0 for kind in RATE_FIELDS},
    )


def _metrics(
    artifact: dict[str, Any],
    observations: list[PlayerGameweekObservation],
) -> dict[str, float]:
    if not observations:
        raise PlayerEventModelError("cannot evaluate an empty observation set")
    brier_totals = {event: 0.0 for event in PROBABILITY_EVENTS}
    saves_error = 0.0
    bps_error = 0.0
    for observation in observations:
        rates = _rates_for(artifact, observation)
        exposure = observation.minutes / 90
        for event in PROBABILITY_EVENTS:
            if event == "defcon":
                threshold = 10 if observation.position == "DEF" else 12
                probability = (
                    0.0
                    if observation.position == "GK"
                    else _poisson_tail(rates[event] * exposure, threshold)
                )
                actual = float(
                    observation.position != "GK"
                    and observation.defensive_contributions >= threshold
                )
            else:
                probability = 1 - math.exp(-rates[event] * exposure)
                actual = float(getattr(observation, RATE_FIELDS[event]) > 0)
            brier_totals[event] += (probability - actual) ** 2
        saves_error += abs(rates["saves"] * exposure - observation.saves)
        bps_error += abs(rates["bps"] * exposure - observation.bps)

    event_brier = sum(brier_totals.values()) / (
        len(observations) * len(PROBABILITY_EVENTS)
    )
    return {
        "event_brier_score": round(event_brier, 6),
        **{
            f"{event}_brier_score": round(total / len(observations), 6)
            for event, total in brier_totals.items()
        },
        "saves_mae": round(saves_error / len(observations), 6),
        "bps_mae": round(bps_error / len(observations), 6),
    }


def train_player_events(
    session: Session,
    dataset_ids: list[str],
    *,
    minimum_history: int = 6,
    player_shrink_minutes: float = 900,
) -> ModelRun:
    datasets, observations = _datasets_and_observations(session, dataset_ids)
    time_keys = sorted({_time_key(row) for row in observations})
    if len(time_keys) < minimum_history + 1:
        raise PlayerEventModelError(
            f"at least {minimum_history + 1} distinct historical Gameweeks are required"
        )
    validation_count = max(1, len(time_keys) // 4)
    validation_keys = set(time_keys[-validation_count:])
    training = [row for row in observations if _time_key(row) not in validation_keys]
    validation = [row for row in observations if _time_key(row) in validation_keys]
    artifact = _fit_artifact(
        training,
        player_shrink_minutes=player_shrink_minutes,
    )
    baseline_artifact = _fit_artifact(
        training,
        player_shrink_minutes=player_shrink_minutes,
        include_players=False,
    )
    metrics = _metrics(artifact, validation)
    baseline = _metrics(baseline_artifact, validation)
    metrics.update(
        {
            "baseline_event_brier_score": baseline["event_brier_score"],
            "evaluation": "locked temporal holdout",
            "validation_samples": len(validation),
        }
    )
    run = ModelRun(
        id=str(uuid.uuid4()),
        model_type=MODEL_TYPE,
        model_version=MODEL_VERSION,
        created_at=datetime.now(timezone.utc),
        training_cutoff=max(row.kickoff_time for row in training),
        validation_cutoff=max(row.kickoff_time for row in validation),
        feature_schema={
            "inputs": ["position", "player identity", "historical minutes"],
            "outputs": list(RATE_FIELDS),
            "leakagePolicy": "only observations before validation Gameweeks",
        },
        artifact=artifact,
        metrics=metrics,
        dataset_checksums=[dataset.checksum for dataset in datasets],
        sample_count=len(training),
        status="experimental",
    )
    session.add(run)
    session.commit()
    return run


def backtest_player_events(
    session: Session,
    dataset_ids: list[str],
    *,
    initial_training_gameweeks: int = 6,
    player_shrink_minutes: float = 900,
) -> BacktestReport:
    datasets, observations = _datasets_and_observations(session, dataset_ids)
    time_keys = sorted({_time_key(row) for row in observations})
    if len(time_keys) <= initial_training_gameweeks:
        raise PlayerEventModelError(
            "not enough Gameweeks for an expanding player-event backtest"
        )
    folds: list[dict[str, Any]] = []
    model_weighted = 0.0
    baseline_weighted = 0.0
    sample_count = 0
    for index in range(initial_training_gameweeks, len(time_keys)):
        test_key = time_keys[index]
        prior_keys = set(time_keys[:index])
        training = [row for row in observations if _time_key(row) in prior_keys]
        test = [row for row in observations if _time_key(row) == test_key]
        artifact = _fit_artifact(
            training,
            player_shrink_minutes=player_shrink_minutes,
        )
        baseline_artifact = _fit_artifact(
            training,
            player_shrink_minutes=player_shrink_minutes,
            include_players=False,
        )
        model_metrics = _metrics(artifact, test)
        baseline_metrics = _metrics(baseline_artifact, test)
        folds.append(
            {
                "season": test_key[0],
                "test_gameweek": test_key[1],
                "training_samples": len(training),
                "test_samples": len(test),
                "model": model_metrics,
                "baseline": baseline_metrics,
            }
        )
        model_weighted += model_metrics["event_brier_score"] * len(test)
        baseline_weighted += baseline_metrics["event_brier_score"] * len(test)
        sample_count += len(test)
    aggregate = {
        "event_brier_score": round(model_weighted / sample_count, 6),
    }
    baseline = {
        "event_brier_score": round(baseline_weighted / sample_count, 6),
    }
    verdict = (
        "beats-baseline"
        if aggregate["event_brier_score"] < baseline["event_brier_score"]
        else "does-not-beat-baseline"
    )
    report = BacktestReport(
        id=str(uuid.uuid4()),
        model_type=MODEL_TYPE,
        model_version=MODEL_VERSION,
        baseline_version=BASELINE_VERSION,
        created_at=datetime.now(timezone.utc),
        dataset_checksums=[dataset.checksum for dataset in datasets],
        configuration={
            "initial_training_gameweeks": initial_training_gameweeks,
            "player_shrink_minutes": player_shrink_minutes,
            "split": "expanding-window by season and Gameweek",
        },
        fold_metrics=folds,
        aggregate_metrics=aggregate,
        baseline_metrics=baseline,
        verdict=verdict,
        sample_count=sample_count,
        status="experimental",
    )
    session.add(report)
    session.commit()
    return report


def latest_player_event_model(session: Session) -> ModelRun | None:
    return session.scalar(
        select(ModelRun)
        .where(ModelRun.model_type == MODEL_TYPE)
        .order_by(desc(ModelRun.created_at))
        .limit(1)
    )
