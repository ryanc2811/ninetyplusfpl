from __future__ import annotations

import math
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

import numpy as np
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import accuracy_score, log_loss, mean_absolute_error, mean_squared_error
from sklearn.preprocessing import StandardScaler
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from .models import (
    BacktestReport,
    ExpectedMinutesForecast,
    FixtureSnapshot,
    HistoricalDataset,
    ModelRun,
    PlayerGameweekObservation,
    PlayerSnapshot,
    RawSnapshot,
    SnapshotPlayerIdentity,
)
from .identity import backfill_historical_identities, resolve_snapshot_identities


MODEL_TYPE = "expected-minutes"
MODEL_VERSION = "expected-minutes-v2-linear-1"
TEAM_ROLE_SIGNALS = {
    "saliba": {
        "mosquera": 0.55,
        "calafiori": 0.20,
        "white": 0.15,
        "hincapie": 0.10,
    }
}
TEAM_FORMATIONS = (
    ("3-4-3", {"GK": 1, "DEF": 3, "MID": 4, "FWD": 3}),
    ("3-5-2", {"GK": 1, "DEF": 3, "MID": 5, "FWD": 2}),
    ("4-4-2", {"GK": 1, "DEF": 4, "MID": 4, "FWD": 2}),
    ("4-3-3", {"GK": 1, "DEF": 4, "MID": 3, "FWD": 3}),
    ("4-5-1", {"GK": 1, "DEF": 4, "MID": 5, "FWD": 1}),
    ("5-4-1", {"GK": 1, "DEF": 5, "MID": 4, "FWD": 1}),
    ("5-3-2", {"GK": 1, "DEF": 5, "MID": 3, "FWD": 2}),
    ("5-2-3", {"GK": 1, "DEF": 5, "MID": 2, "FWD": 3}),
)
FEATURE_NAMES = [
    "rolling_minutes_3",
    "rolling_minutes_5",
    "start_rate_5",
    "appearance_rate_5",
    "sixty_rate_5",
    "early_sub_rate_5",
    "days_rest",
    "difficulty",
    "was_home",
    "position_def",
    "position_mid",
    "position_fwd",
]


@dataclass(frozen=True)
class FeatureExample:
    values: list[float]
    minutes: int
    state: int
    kickoff_time: datetime
    time_key: tuple[str, int]
    player_source_id: int
    player_identity_id: Optional[str]


@dataclass(frozen=True)
class ExpectedMinutesOutput:
    start_probability: float
    substitute_probability: float
    zero_minutes_probability: float
    expected_minutes_if_start: float
    expected_minutes_if_substitute: float
    expected_minutes: float
    sixty_minute_probability: float
    early_substitution_probability: float


class ModelTrainingError(ValueError):
    pass


def _feature_vector(
    prior: list[PlayerGameweekObservation],
    *,
    kickoff_time: datetime,
    difficulty: int,
    was_home: bool,
    position: str,
) -> list[float]:
    recent_3 = prior[-3:]
    recent_5 = prior[-5:]

    def average(values: Iterable[float]) -> float:
        values = list(values)
        return sum(values) / len(values) if values else 0.0

    previous_kickoff = prior[-1].kickoff_time if prior else None
    if previous_kickoff and previous_kickoff.tzinfo is None:
        previous_kickoff = previous_kickoff.replace(tzinfo=timezone.utc)
    current_kickoff = kickoff_time
    if current_kickoff.tzinfo is None:
        current_kickoff = current_kickoff.replace(tzinfo=timezone.utc)
    days_rest = (
        min(21.0, max(0.0, (current_kickoff - previous_kickoff).total_seconds() / 86400))
        if previous_kickoff
        else 7.0
    )
    return [
        average(row.minutes for row in recent_3),
        average(row.minutes for row in recent_5),
        average(float(row.started) for row in recent_5),
        average(float(row.minutes > 0) for row in recent_5),
        average(float(row.minutes >= 60) for row in recent_5),
        average(float(row.started and row.minutes < 60) for row in recent_5),
        days_rest,
        float(max(1, min(5, difficulty))),
        float(was_home),
        float(position == "DEF"),
        float(position == "MID"),
        float(position == "FWD"),
    ]


def build_training_examples(
    observations: list[PlayerGameweekObservation],
    minimum_history: int = 3,
) -> list[FeatureExample]:
    histories: dict[str, list[PlayerGameweekObservation]] = defaultdict(list)
    examples: list[FeatureExample] = []
    rows_by_gameweek: dict[tuple[str, int], list[PlayerGameweekObservation]] = defaultdict(list)
    for row in observations:
        rows_by_gameweek[(row.season_id, row.gameweek)].append(row)

    for time_key in sorted(rows_by_gameweek):
        gameweek_rows = sorted(
            rows_by_gameweek[time_key],
            key=lambda value: (value.kickoff_time, value.fixture_source_id, value.id),
        )
        for row in gameweek_rows:
            player_key = row.player_identity_id or f"{row.season_id}:{row.player_source_id}"
            prior = histories[player_key]
            if len(prior) >= minimum_history:
                state = 2 if row.started else (1 if row.minutes > 0 else 0)
                examples.append(
                    FeatureExample(
                        values=_feature_vector(
                            prior,
                            kickoff_time=row.kickoff_time,
                            difficulty=row.difficulty,
                            was_home=row.was_home,
                            position=row.position,
                        ),
                        minutes=row.minutes,
                        state=state,
                        kickoff_time=row.kickoff_time,
                        time_key=time_key,
                        player_source_id=row.player_source_id,
                        player_identity_id=row.player_identity_id,
                    )
                )
        for row in gameweek_rows:
            player_key = row.player_identity_id or f"{row.season_id}:{row.player_source_id}"
            histories[player_key].append(row)
    return examples


def _temporal_split(examples: list[FeatureExample]):
    time_keys = sorted({row.time_key for row in examples})
    if len(time_keys) < 6:
        raise ModelTrainingError("at least six historical Gameweeks are required after feature warm-up")
    train_index = max(2, int(len(time_keys) * 0.6))
    validation_index = max(train_index + 1, int(len(time_keys) * 0.8))
    if validation_index >= len(time_keys):
        validation_index = len(time_keys) - 1
    training_keys = set(time_keys[:train_index])
    validation_keys = set(time_keys[train_index:validation_index])
    test_keys = set(time_keys[validation_index:])
    return (
        [row for row in examples if row.time_key in training_keys],
        [row for row in examples if row.time_key in validation_keys],
        [row for row in examples if row.time_key in test_keys],
    )


def _matrix(examples: list[FeatureExample]) -> np.ndarray:
    return np.asarray([row.values for row in examples], dtype=float)


def _sigmoid(values: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(values, -30, 30)))


def _serialize_classifier(model: LogisticRegression) -> dict[str, Any]:
    return {
        "classes": [int(value) for value in model.classes_],
        "coefficients": model.coef_.astype(float).tolist(),
        "intercepts": model.intercept_.astype(float).tolist(),
    }


def _calibrate(
    model: LogisticRegression,
    x_validation: np.ndarray,
    y_validation: np.ndarray,
) -> list[dict[str, float]]:
    scores = model.decision_function(x_validation)
    if scores.ndim == 1:
        scores = np.column_stack([-scores, scores])
    calibrators: list[dict[str, float]] = []
    for index, class_value in enumerate(model.classes_):
        binary_target = (y_validation == class_value).astype(int)
        if len(np.unique(binary_target)) < 2:
            calibrators.append({"slope": 1.0, "intercept": 0.0})
            continue
        calibrator = LogisticRegression(solver="lbfgs")
        calibrator.fit(scores[:, [index]], binary_target)
        calibrators.append(
            {
                "slope": float(calibrator.coef_[0][0]),
                "intercept": float(calibrator.intercept_[0]),
            }
        )
    return calibrators


def _predict_probabilities(artifact: dict[str, Any], vectors: np.ndarray) -> np.ndarray:
    scaler = artifact["scaler"]
    scaled = (vectors - np.asarray(scaler["mean"])) / np.asarray(scaler["scale"])
    classifier = artifact["state_classifier"]
    scores = (
        scaled @ np.asarray(classifier["coefficients"], dtype=float).T
        + np.asarray(classifier["intercepts"], dtype=float)
    )
    calibrated = np.column_stack(
        [
            _sigmoid(scores[:, index] * item["slope"] + item["intercept"])
            for index, item in enumerate(artifact["calibrators"])
        ]
    )
    totals = calibrated.sum(axis=1, keepdims=True)
    return calibrated / np.where(totals == 0, 1, totals)


def _ridge_artifact(model: Optional[Ridge], fallback: float) -> dict[str, Any]:
    if model is None:
        return {"coefficients": [0.0] * len(FEATURE_NAMES), "intercept": float(fallback)}
    return {
        "coefficients": model.coef_.astype(float).tolist(),
        "intercept": float(model.intercept_),
    }


def _ridge_predict(artifact: dict[str, Any], scaled: np.ndarray) -> np.ndarray:
    return scaled @ np.asarray(artifact["coefficients"], dtype=float) + float(artifact["intercept"])


def _ece(probabilities: np.ndarray, targets: np.ndarray, bins: int = 10) -> float:
    error = 0.0
    for lower in np.linspace(0, 1, bins, endpoint=False):
        upper = lower + 1 / bins
        mask = (probabilities >= lower) & (probabilities < upper)
        if mask.any():
            error += float(mask.mean()) * abs(
                float(probabilities[mask].mean()) - float(targets[mask].mean())
            )
    return error


def _fit_artifact(
    training: list[FeatureExample],
    validation: list[FeatureExample],
    minimum_history: int,
) -> dict[str, Any]:
    x_train = _matrix(training)
    x_validation = _matrix(validation)
    y_train = np.asarray([row.state for row in training], dtype=int)
    y_validation = np.asarray([row.state for row in validation], dtype=int)
    if set(np.unique(y_train)) != {0, 1, 2}:
        raise ModelTrainingError("training data must include starts, substitute appearances, and zero minutes")

    scaler = StandardScaler().fit(x_train)
    scaled_train = scaler.transform(x_train)
    scaled_validation = scaler.transform(x_validation)
    classifier = LogisticRegression(max_iter=1000, solver="lbfgs")
    classifier.fit(scaled_train, y_train)
    calibrators = _calibrate(classifier, scaled_validation, y_validation)

    start_mask = y_train == 2
    substitute_mask = y_train == 1
    training_minutes = np.asarray([row.minutes for row in training])
    start_model = Ridge(alpha=4.0, solver="lsqr").fit(
        scaled_train[start_mask],
        training_minutes[start_mask],
    )
    substitute_model = (
        Ridge(alpha=4.0, solver="lsqr").fit(
            scaled_train[substitute_mask],
            training_minutes[substitute_mask],
        )
        if substitute_mask.sum() >= 2
        else None
    )
    start_minutes = [row.minutes for row in training if row.state == 2]
    substitute_minutes = [row.minutes for row in training if row.state == 1]
    early_sub_rate = sum(value < 60 for value in start_minutes) / len(start_minutes)
    return {
        "feature_names": FEATURE_NAMES,
        "scaler": {
            "mean": scaler.mean_.astype(float).tolist(),
            "scale": scaler.scale_.astype(float).tolist(),
        },
        "state_classifier": _serialize_classifier(classifier),
        "calibrators": calibrators,
        "start_minutes_regressor": _ridge_artifact(start_model, float(np.mean(start_minutes))),
        "substitute_minutes_regressor": _ridge_artifact(
            substitute_model,
            float(np.mean(substitute_minutes)) if substitute_minutes else 15.0,
        ),
        "early_substitution_rate": float(early_sub_rate),
        "minimum_history": minimum_history,
    }


def _evaluate_artifact(
    artifact: dict[str, Any],
    test: list[FeatureExample],
) -> dict[str, Any]:
    x_test = _matrix(test)
    y_test = np.asarray([row.state for row in test], dtype=int)
    probabilities = _predict_probabilities(artifact, x_test)
    class_order = artifact["state_classifier"]["classes"]
    zero_index = class_order.index(0)
    start_index = class_order.index(2)
    sub_index = class_order.index(1)
    predicted_states = np.asarray(class_order)[np.argmax(probabilities, axis=1)]
    scaler = artifact["scaler"]
    scaled_test = (x_test - np.asarray(scaler["mean"])) / np.asarray(scaler["scale"])
    predicted_start_minutes = np.clip(
        _ridge_predict(artifact["start_minutes_regressor"], scaled_test),
        45,
        90,
    )
    predicted_sub_minutes = np.clip(
        _ridge_predict(artifact["substitute_minutes_regressor"], scaled_test),
        1,
        45,
    )
    predicted_minutes = (
        probabilities[:, start_index] * predicted_start_minutes
        + probabilities[:, sub_index] * predicted_sub_minutes
    )
    actual_minutes = np.asarray([row.minutes for row in test], dtype=float)
    one_hot = np.eye(3)[y_test]
    return {
        "test_rows": len(test),
        "state_log_loss": float(log_loss(y_test, probabilities, labels=class_order)),
        "state_brier_score": float(np.mean(np.sum((probabilities - one_hot) ** 2, axis=1))),
        "state_accuracy": float(accuracy_score(y_test, predicted_states)),
        "start_accuracy": float(accuracy_score(y_test == 2, probabilities[:, start_index] >= 0.5)),
        "zero_minutes_accuracy": float(
            accuracy_score(y_test == 0, probabilities[:, zero_index] >= 0.5)
        ),
        "start_calibration_error": _ece(
            probabilities[:, start_index],
            (y_test == 2).astype(float),
        ),
        "minutes_mae": float(mean_absolute_error(actual_minutes, predicted_minutes)),
        "minutes_rmse": float(math.sqrt(mean_squared_error(actual_minutes, predicted_minutes))),
    }


def _baseline_metrics(test: list[FeatureExample]) -> dict[str, Any]:
    vectors = _matrix(test)
    start_probability = np.clip(vectors[:, 2], 0, 1)
    appearance_probability = np.maximum(start_probability, np.clip(vectors[:, 3], 0, 1))
    probabilities = np.column_stack(
        [
            1 - appearance_probability,
            appearance_probability - start_probability,
            start_probability,
        ]
    )
    y_test = np.asarray([row.state for row in test], dtype=int)
    one_hot = np.eye(3)[y_test]
    predicted_states = np.argmax(probabilities, axis=1)
    predicted_minutes = np.clip(vectors[:, 0], 0, 90)
    actual_minutes = np.asarray([row.minutes for row in test], dtype=float)
    safe_probabilities = np.clip(probabilities, 1e-6, 1 - 1e-6)
    safe_probabilities = safe_probabilities / safe_probabilities.sum(axis=1, keepdims=True)
    return {
        "test_rows": len(test),
        "state_log_loss": float(
            log_loss(y_test, safe_probabilities, labels=[0, 1, 2])
        ),
        "state_brier_score": float(np.mean(np.sum((probabilities - one_hot) ** 2, axis=1))),
        "state_accuracy": float(accuracy_score(y_test, predicted_states)),
        "start_accuracy": float(accuracy_score(y_test == 2, start_probability >= 0.5)),
        "zero_minutes_accuracy": float(
            accuracy_score(y_test == 0, probabilities[:, 0] >= 0.5)
        ),
        "start_calibration_error": _ece(start_probability, (y_test == 2).astype(float)),
        "minutes_mae": float(mean_absolute_error(actual_minutes, predicted_minutes)),
        "minutes_rmse": float(math.sqrt(mean_squared_error(actual_minutes, predicted_minutes))),
    }


def _weighted_metrics(folds: list[dict[str, Any]]) -> dict[str, Any]:
    total_rows = sum(int(fold["test_rows"]) for fold in folds)
    metric_names = [name for name in folds[0] if name != "test_rows"]
    return {
        "test_rows": total_rows,
        **{
            name: sum(float(fold[name]) * int(fold["test_rows"]) for fold in folds) / total_rows
            for name in metric_names
        },
    }


def train_expected_minutes(
    session: Session,
    dataset_ids: list[str],
    *,
    minimum_history: int = 3,
) -> ModelRun:
    datasets = list(
        session.scalars(select(HistoricalDataset).where(HistoricalDataset.id.in_(dataset_ids)))
    )
    if len(datasets) != len(set(dataset_ids)):
        raise ModelTrainingError("one or more historical datasets do not exist")
    backfill_historical_identities(session, dataset_ids)
    observations = list(
        session.scalars(
            select(PlayerGameweekObservation).where(
                PlayerGameweekObservation.dataset_id.in_(dataset_ids)
            )
        )
    )
    examples = build_training_examples(observations, minimum_history)
    training, validation, test = _temporal_split(examples)
    if min(len(training), len(validation), len(test)) < 6:
        raise ModelTrainingError("temporal train, validation, and test partitions need at least six rows")

    artifact = _fit_artifact(training, validation, minimum_history)
    metrics = {**_evaluate_artifact(artifact, test), "evaluation": "locked temporal holdout"}
    run = ModelRun(
        id=str(uuid.uuid4()),
        model_type=MODEL_TYPE,
        model_version=MODEL_VERSION,
        created_at=datetime.now(timezone.utc),
        training_cutoff=max(row.kickoff_time for row in training),
        validation_cutoff=max(row.kickoff_time for row in validation),
        feature_schema={
            "names": FEATURE_NAMES,
            "leakage_policy": "features use only observations before the target fixture",
            "target_states": {"0": "zero minutes", "1": "substitute", "2": "start"},
        },
        artifact=artifact,
        metrics=metrics,
        dataset_checksums=[dataset.checksum for dataset in datasets],
        sample_count=len(examples),
        status="experimental",
    )
    session.add(run)
    session.commit()
    return run


def backtest_expected_minutes(
    session: Session,
    dataset_ids: list[str],
    *,
    minimum_history: int = 3,
    initial_training_gameweeks: int = 6,
    calibration_gameweeks: int = 2,
) -> BacktestReport:
    datasets = list(
        session.scalars(select(HistoricalDataset).where(HistoricalDataset.id.in_(dataset_ids)))
    )
    if len(datasets) != len(set(dataset_ids)):
        raise ModelTrainingError("one or more historical datasets do not exist")
    backfill_historical_identities(session, dataset_ids)
    observations = list(
        session.scalars(
            select(PlayerGameweekObservation).where(
                PlayerGameweekObservation.dataset_id.in_(dataset_ids)
            )
        )
    )
    examples = build_training_examples(observations, minimum_history)
    time_keys = sorted({row.time_key for row in examples})
    first_test_index = max(initial_training_gameweeks, calibration_gameweeks + 3)
    if len(time_keys) <= first_test_index:
        raise ModelTrainingError("not enough ordered Gameweeks for an expanding-window backtest")

    fold_metrics: list[dict[str, Any]] = []
    baseline_folds: list[dict[str, Any]] = []
    for test_index in range(first_test_index, len(time_keys)):
        validation_start = test_index - calibration_gameweeks
        training_keys = set(time_keys[:validation_start])
        validation_keys = set(time_keys[validation_start:test_index])
        test_key = time_keys[test_index]
        training = [row for row in examples if row.time_key in training_keys]
        validation = [row for row in examples if row.time_key in validation_keys]
        test = [row for row in examples if row.time_key == test_key]
        if not training or not validation or not test:
            continue
        try:
            artifact = _fit_artifact(training, validation, minimum_history)
        except ModelTrainingError:
            continue
        model_metrics = _evaluate_artifact(artifact, test)
        baseline_metrics = _baseline_metrics(test)
        fold_metrics.append(
            {
                "test_season": test_key[0],
                "test_gameweek": test_key[1],
                "training_rows": len(training),
                "validation_rows": len(validation),
                **model_metrics,
            }
        )
        baseline_folds.append(baseline_metrics)
    if not fold_metrics:
        raise ModelTrainingError("no valid expanding-window folds could be trained")

    numeric_model_folds = [
        {key: value for key, value in fold.items() if key in baseline_folds[0]}
        for fold in fold_metrics
    ]
    aggregate = _weighted_metrics(numeric_model_folds)
    baseline = _weighted_metrics(baseline_folds)
    verdict = (
        "beats-baseline"
        if aggregate["minutes_mae"] < baseline["minutes_mae"]
        and aggregate["state_brier_score"] < baseline["state_brier_score"]
        else "does-not-beat-baseline"
    )
    report = BacktestReport(
        id=str(uuid.uuid4()),
        model_type=MODEL_TYPE,
        model_version=MODEL_VERSION,
        baseline_version="rolling-5-state-and-rolling-3-minutes-v1",
        created_at=datetime.now(timezone.utc),
        dataset_checksums=[dataset.checksum for dataset in datasets],
        configuration={
            "minimum_history": minimum_history,
            "initial_training_gameweeks": initial_training_gameweeks,
            "calibration_gameweeks": calibration_gameweeks,
            "split": "expanding-window by season and Gameweek",
        },
        fold_metrics=fold_metrics,
        aggregate_metrics=aggregate,
        baseline_metrics=baseline,
        verdict=verdict,
        sample_count=aggregate["test_rows"],
        status="experimental",
    )
    session.add(report)
    session.commit()
    return report


def predict_expected_minutes(artifact: dict[str, Any], values: list[float]) -> ExpectedMinutesOutput:
    vector = np.asarray([values], dtype=float)
    probabilities = _predict_probabilities(artifact, vector)[0]
    classes = artifact["state_classifier"]["classes"]
    probability_by_state = {state: float(probabilities[index]) for index, state in enumerate(classes)}
    scaler = artifact["scaler"]
    scaled = (vector - np.asarray(scaler["mean"])) / np.asarray(scaler["scale"])
    start_minutes = float(
        np.clip(_ridge_predict(artifact["start_minutes_regressor"], scaled)[0], 45, 90)
    )
    substitute_minutes = float(
        np.clip(_ridge_predict(artifact["substitute_minutes_regressor"], scaled)[0], 1, 45)
    )
    start_probability = probability_by_state.get(2, 0.0)
    substitute_probability = probability_by_state.get(1, 0.0)
    zero_probability = probability_by_state.get(0, 0.0)
    early_probability = start_probability * artifact["early_substitution_rate"]
    return ExpectedMinutesOutput(
        start_probability=start_probability,
        substitute_probability=substitute_probability,
        zero_minutes_probability=zero_probability,
        expected_minutes_if_start=start_minutes,
        expected_minutes_if_substitute=substitute_minutes,
        expected_minutes=start_probability * start_minutes + substitute_probability * substitute_minutes,
        sixty_minute_probability=max(0.0, start_probability - early_probability),
        early_substitution_probability=early_probability,
    )


def _availability_factor(player: PlayerSnapshot) -> float:
    if player.chance_next_round is not None:
        return max(0.0, min(1.0, player.chance_next_round / 100))
    return {"a": 1.0, "d": 0.75, "i": 0.0, "s": 0.0, "u": 0.0, "n": 0.0}.get(
        player.status,
        0.8,
    )


def _normalise_player_name(value: str) -> str:
    return "".join(character for character in value.lower() if character.isalnum())


def _established_role_probability(player: PlayerSnapshot, observed_matches: int) -> float:
    position_floor = {"GK": 4.0, "DEF": 4.0, "MID": 4.5, "FWD": 4.5}[player.position]
    price_role = 0.55 + max(0.0, player.price - position_floor) * 0.08
    observed_rate = (
        min(1.0, max(0.0, player.starts / observed_matches))
        if observed_matches > 0
        else 0.0
    )
    return min(0.94, max(0.55, price_role, observed_rate))


def apply_team_opportunity_adjustments(
    players: list[PlayerSnapshot],
    forecasts: list[ExpectedMinutesForecast],
    observed_matches: int,
) -> list[ExpectedMinutesForecast]:
    """Conserve injury-created positional opportunity inside each team."""
    forecast_by_player = {forecast.player_source_id: forecast for forecast in forecasts}
    unavailable = [player for player in players if _availability_factor(player) <= 0.25]

    for absent in unavailable:
        vacancy = _established_role_probability(absent, observed_matches) * (
            1 - _availability_factor(absent)
        )
        candidates = [
            player
            for player in players
            if player.team_source_id == absent.team_source_id
            and player.position == absent.position
            and player.source_id != absent.source_id
            and _availability_factor(player) >= 0.6
            and player.source_id in forecast_by_player
        ]
        if not candidates:
            continue
        role_signal = TEAM_ROLE_SIGNALS.get(_normalise_player_name(absent.web_name))
        ranked = sorted(
            candidates,
            key=lambda player: (
                forecast_by_player[player.source_id].start_probability,
                player.price,
            ),
            reverse=True,
        )[:3]
        generic_scores = {
            player.source_id: max(
                0.1,
                forecast_by_player[player.source_id].start_probability
                + player.price / 10,
            )
            for player in ranked
        }
        generic_total = sum(generic_scores.values()) or 1.0

        for candidate in candidates:
            forecast = forecast_by_player[candidate.source_id]
            if forecast.features.get("team_opportunity_applied"):
                continue
            signalled_share = (
                role_signal.get(_normalise_player_name(candidate.web_name))
                if role_signal
                else None
            )
            share = (
                signalled_share
                if signalled_share is not None
                else 0.0
                if role_signal
                else generic_scores.get(candidate.source_id, 0.0) / generic_total
            )
            if share <= 0:
                continue
            original_start = forecast.start_probability
            next_start = min(0.98, original_start + vacancy * share)
            remaining = 1 - next_start
            non_start_total = max(0.0001, 1 - original_start)
            next_substitute = min(
                remaining,
                forecast.substitute_probability * remaining / non_start_total,
            )
            start_ratio = next_start / max(0.0001, original_start)
            forecast.start_probability = next_start
            forecast.substitute_probability = next_substitute
            forecast.zero_minutes_probability = max(
                0.0,
                1 - next_start - next_substitute,
            )
            forecast.expected_minutes = (
                next_start * forecast.expected_minutes_if_start
                + next_substitute * forecast.expected_minutes_if_substitute
            )
            forecast.sixty_minute_probability = min(
                next_start,
                forecast.sixty_minute_probability * start_ratio,
            )
            forecast.early_substitution_probability = min(
                next_start,
                forecast.early_substitution_probability * start_ratio,
            )
            forecast.confidence = max(
                forecast.confidence,
                0.72 if role_signal else 0.55,
            )
            forecast.features = {
                **forecast.features,
                "team_opportunity_applied": True,
                "team_opportunity_start_boost": round(next_start - original_start, 4),
                "unavailable_teammate": absent.web_name,
            }
            forecast.reasons = [
                *forecast.reasons,
                (
                    f"team opportunity: {absent.web_name} unavailable; "
                    f"{candidate.web_name} receives {share:.0%} of the replacement prior"
                ),
            ]
    return forecasts


def _lineup_role_score(
    player: PlayerSnapshot,
    forecast: ExpectedMinutesForecast,
    observed_matches: int,
) -> float:
    position_floor = {"GK": 4.0, "DEF": 4.0, "MID": 4.5, "FWD": 4.5}[player.position]
    observed_start_rate = (
        min(1.0, max(0.0, player.starts / max(1, observed_matches)))
        if player.starts > 0
        else 0.0
    )
    price_signal = min(1.0, max(0.0, (player.price - position_floor) / 7))
    ownership_signal = min(
        1.0,
        max(
            0.0,
            math.log1p(float(getattr(player, "selected_by_percent", 0.0)))
            / math.log(101),
        ),
    )
    return (
        forecast.start_probability * 0.5
        + observed_start_rate * 0.25
        + price_signal * 0.15
        + ownership_signal * 0.1
    )


def _allocate_starting_probability(
    candidates: list[PlayerSnapshot],
    target: int,
    forecast_by_player: dict[int, ExpectedMinutesForecast],
    observed_matches: int,
) -> dict[int, float]:
    if not candidates:
        return {}
    scored = [
        (
            player,
            _lineup_role_score(
                player,
                forecast_by_player[player.source_id],
                observed_matches,
            ),
            _availability_factor(player),
        )
        for player in candidates
    ]
    lower, upper = -2.0, 2.0
    temperature = 0.075
    for _ in range(70):
        threshold = (lower + upper) / 2
        total = sum(
            availability
            / (1 + math.exp(-max(-30.0, min(30.0, (score - threshold) / temperature))))
            for _, score, availability in scored
        )
        if total > target:
            lower = threshold
        else:
            upper = threshold
    threshold = (lower + upper) / 2
    return {
        player.source_id: min(
            0.98,
            max(
                0.0,
                availability
                / (1 + math.exp(-max(-30.0, min(30.0, (score - threshold) / temperature)))),
            ),
        )
        for player, score, availability in scored
    }


def apply_team_lineup_constraints(
    players: list[PlayerSnapshot],
    forecasts: list[ExpectedMinutesForecast],
    observed_matches: int,
) -> list[ExpectedMinutesForecast]:
    """Infer one legal, probabilistic XI per complete club roster."""
    forecast_by_player = {forecast.player_source_id: forecast for forecast in forecasts}
    players_by_team: dict[int, list[PlayerSnapshot]] = defaultdict(list)
    for player in players:
        if player.source_id in forecast_by_player:
            players_by_team[player.team_source_id].append(player)

    for team_players in players_by_team.values():
        if len(team_players) < 15:
            continue
        available_by_position = {
            position: [
                player
                for player in team_players
                if player.position == position and _availability_factor(player) > 0
            ]
            for position in ("GK", "DEF", "MID", "FWD")
        }
        viable = [
            (label, formation)
            for label, formation in TEAM_FORMATIONS
            if all(
                len(available_by_position[position]) >= formation[position]
                for position in formation
            )
        ]
        if not viable:
            continue

        def formation_score(item: tuple[str, dict[str, int]]) -> float:
            _, formation = item
            return sum(
                sum(
                    sorted(
                        (
                            _lineup_role_score(
                                player,
                                forecast_by_player[player.source_id],
                                observed_matches,
                            )
                            for player in available_by_position[position]
                        ),
                        reverse=True,
                    )[: formation[position]]
                )
                for position in formation
            )

        formation_label, formation = max(viable, key=formation_score)
        for position in ("GK", "DEF", "MID", "FWD"):
            positional = [
                player for player in team_players if player.position == position
            ]
            probabilities = _allocate_starting_probability(
                positional,
                formation[position],
                forecast_by_player,
                observed_matches,
            )
            ranked = sorted(
                positional,
                key=lambda player: probabilities.get(player.source_id, 0.0),
                reverse=True,
            )
            ranks = {
                player.source_id: index
                for index, player in enumerate(ranked, start=1)
            }
            for player in positional:
                forecast = forecast_by_player[player.source_id]
                if forecast.features.get("team_lineup_applied"):
                    continue
                original_start = forecast.start_probability
                next_start = probabilities.get(player.source_id, 0.0)
                remaining = 1 - next_start
                non_start_total = max(0.0001, 1 - original_start)
                next_substitute = min(
                    remaining,
                    forecast.substitute_probability * remaining / non_start_total,
                )
                sixty_given_start = (
                    forecast.sixty_minute_probability / original_start
                    if original_start > 0
                    else max(
                        0.25,
                        min(0.99, (forecast.expected_minutes_if_start - 48) / 25),
                    )
                )
                early_given_start = (
                    forecast.early_substitution_probability / original_start
                    if original_start > 0
                    else 1 - sixty_given_start
                )
                forecast.start_probability = next_start
                forecast.substitute_probability = next_substitute
                forecast.zero_minutes_probability = max(
                    0.0,
                    1 - next_start - next_substitute,
                )
                forecast.expected_minutes = (
                    next_start * forecast.expected_minutes_if_start
                    + next_substitute * forecast.expected_minutes_if_substitute
                )
                forecast.sixty_minute_probability = min(
                    next_start,
                    next_start * sixty_given_start,
                )
                forecast.early_substitution_probability = min(
                    next_start,
                    next_start * early_given_start,
                )
                forecast.confidence = max(forecast.confidence, 0.62)
                forecast.features = {
                    **forecast.features,
                    "team_lineup_applied": True,
                    "team_lineup_formation": formation_label,
                    "team_lineup_rank": ranks[player.source_id],
                }
                if abs(next_start - original_start) >= 0.025:
                    forecast.reasons = [
                        *forecast.reasons,
                        (
                            f"team lineup constraint: {formation_label} inferred; "
                            f"ranked {ranks[player.source_id]}/{len(positional)} "
                            f"among {position} candidates"
                        ),
                    ]
    return forecasts


def generate_latest_forecasts(session: Session, model_run_id: Optional[str] = None):
    model_run = (
        session.get(ModelRun, model_run_id)
        if model_run_id
        else session.scalar(
            select(ModelRun)
            .where(ModelRun.model_type == MODEL_TYPE)
            .order_by(desc(ModelRun.created_at))
            .limit(1)
        )
    )
    if not model_run:
        raise ModelTrainingError("no expected-minutes model run is available")
    snapshot = session.scalar(
        select(RawSnapshot)
        .where(RawSnapshot.ingestion_status == "succeeded")
        .order_by(desc(RawSnapshot.retrieved_at))
        .limit(1)
    )
    if not snapshot:
        raise ModelTrainingError("no successful current snapshot is available")

    resolve_snapshot_identities(session, snapshot.id, snapshot.season_id)
    players = list(
        session.scalars(select(PlayerSnapshot).where(PlayerSnapshot.snapshot_id == snapshot.id))
    )
    identity_mappings = {
        mapping.player_source_id: mapping
        for mapping in session.scalars(
            select(SnapshotPlayerIdentity).where(
                SnapshotPlayerIdentity.snapshot_id == snapshot.id
            )
        )
    }
    identity_ids = [
        mapping.player_identity_id
        for mapping in identity_mappings.values()
        if mapping.player_identity_id
    ]
    observations = list(
        session.scalars(
            select(PlayerGameweekObservation)
            .where(PlayerGameweekObservation.player_identity_id.in_(identity_ids))
            .order_by(PlayerGameweekObservation.kickoff_time)
        )
    ) if identity_ids else []
    history_by_identity: dict[str, list[PlayerGameweekObservation]] = defaultdict(list)
    for observation in observations:
        if observation.player_identity_id:
            history_by_identity[observation.player_identity_id].append(observation)
    fixtures = list(
        session.scalars(
            select(FixtureSnapshot)
            .where(
                FixtureSnapshot.snapshot_id == snapshot.id,
                FixtureSnapshot.event == snapshot.gameweek,
            )
        )
    )
    fixture_by_team: dict[int, tuple[FixtureSnapshot, bool]] = {}
    for fixture in fixtures:
        fixture_by_team[fixture.home_team_source_id] = (fixture, True)
        fixture_by_team[fixture.away_team_source_id] = (fixture, False)

    generated_at = datetime.now(timezone.utc)
    forecasts: list[ExpectedMinutesForecast] = []
    for player in players:
        identity_mapping = identity_mappings.get(player.source_id)
        player_identity_id = (
            identity_mapping.player_identity_id if identity_mapping else None
        )
        existing = session.scalar(
            select(ExpectedMinutesForecast).where(
                ExpectedMinutesForecast.model_run_id == model_run.id,
                ExpectedMinutesForecast.snapshot_id == snapshot.id,
                ExpectedMinutesForecast.player_source_id == player.source_id,
            )
        )
        if existing:
            forecasts.append(existing)
            continue
        fixture_entry = fixture_by_team.get(player.team_source_id)
        fixture, was_home = fixture_entry if fixture_entry else (None, True)
        difficulty = (
            fixture.home_difficulty if fixture and was_home else fixture.away_difficulty if fixture else 3
        )
        kickoff = fixture.kickoff_time if fixture and fixture.kickoff_time else generated_at
        comparison_kickoff = kickoff
        if comparison_kickoff.tzinfo is None:
            comparison_kickoff = comparison_kickoff.replace(tzinfo=timezone.utc)
        training_cutoff = model_run.training_cutoff
        if training_cutoff.tzinfo is None:
            training_cutoff = training_cutoff.replace(tzinfo=timezone.utc)
        if training_cutoff >= comparison_kickoff:
            raise ModelTrainingError(
                "model training cutoff must be earlier than every forecast fixture"
            )
        history = (
            [
                observation
                for observation in history_by_identity[player_identity_id]
                if (
                    observation.kickoff_time.replace(tzinfo=timezone.utc)
                    if observation.kickoff_time.tzinfo is None
                    else observation.kickoff_time
                )
                < comparison_kickoff
            ]
            if player_identity_id
            else []
        )
        features = _feature_vector(
            history,
            kickoff_time=kickoff,
            difficulty=difficulty,
            was_home=was_home,
            position=player.position,
        )
        raw = predict_expected_minutes(model_run.artifact, features)
        availability = _availability_factor(player)
        start_probability = raw.start_probability * availability
        substitute_probability = raw.substitute_probability * availability
        zero_probability = 1 - start_probability - substitute_probability
        expected_minutes = (
            start_probability * raw.expected_minutes_if_start
            + substitute_probability * raw.expected_minutes_if_substitute
        )
        confidence = min(0.9, 0.3 + min(len(history), 10) * 0.05)
        reasons = [
            f"{min(len(history), 5)} prior matches inform recent-minute features",
            f"fixture difficulty {difficulty}/5",
        ]
        if availability < 1:
            reasons.append(f"official availability reduces selection probability to {availability:.0%}")
        if not history:
            reasons.append("no matched history; position and league priors dominate")
        forecast = ExpectedMinutesForecast(
            model_run_id=model_run.id,
            snapshot_id=snapshot.id,
            player_source_id=player.source_id,
            player_identity_id=player_identity_id,
            generated_at=generated_at,
            start_probability=start_probability,
            substitute_probability=substitute_probability,
            zero_minutes_probability=zero_probability,
            expected_minutes_if_start=raw.expected_minutes_if_start,
            expected_minutes_if_substitute=raw.expected_minutes_if_substitute,
            expected_minutes=expected_minutes,
            sixty_minute_probability=raw.sixty_minute_probability * availability,
            early_substitution_probability=raw.early_substitution_probability * availability,
            confidence=confidence,
            features=dict(zip(FEATURE_NAMES, features)),
            reasons=reasons,
        )
        session.add(forecast)
        forecasts.append(forecast)
    apply_team_opportunity_adjustments(
        players,
        forecasts,
        observed_matches=max(1, snapshot.gameweek - 1),
    )
    apply_team_lineup_constraints(
        players,
        forecasts,
        observed_matches=max(1, snapshot.gameweek - 1),
    )
    session.commit()
    return forecasts
