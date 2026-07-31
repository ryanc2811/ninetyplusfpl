from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

import numpy as np
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from .models import (
    BacktestReport,
    FixtureSnapshot,
    HistoricalDataset,
    MatchForecast,
    ModelRun,
    RawSnapshot,
    TeamMatchObservation,
    TeamSnapshot,
)


MODEL_TYPE = "team-strength"
MODEL_VERSION = "time-decayed-poisson-v1"
BASELINE_VERSION = "league-home-away-average-v1"


@dataclass(frozen=True)
class MatchProbabilityOutput:
    expected_home_goals: float
    expected_away_goals: float
    home_win_probability: float
    draw_probability: float
    away_win_probability: float
    home_clean_sheet_probability: float
    away_clean_sheet_probability: float
    both_teams_score_probability: float
    over_two_five_probability: float
    scoreline_probabilities: list[dict[str, Any]]


class TeamModelError(ValueError):
    pass


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _poisson_probability(goals: int, expected_goals: float) -> float:
    return math.exp(-expected_goals) * expected_goals**goals / math.factorial(goals)


def _target_goals(match: TeamMatchObservation) -> tuple[float, float]:
    if match.home_expected_goals is not None and match.away_expected_goals is not None:
        return match.home_expected_goals, match.away_expected_goals
    return float(match.home_goals), float(match.away_goals)


def fit_team_strength_artifact(
    matches: list[TeamMatchObservation],
    *,
    half_life_days: float = 180,
    smoothing_matches: float = 5,
) -> dict[str, Any]:
    if len(matches) < 12:
        raise TeamModelError("at least 12 completed matches are required")
    ordered = sorted(matches, key=lambda match: match.kickoff_time)
    reference_time = _aware(ordered[-1].kickoff_time)
    weighted_matches: list[tuple[TeamMatchObservation, float, float, float]] = []
    for match in ordered:
        age_days = max(
            0.0,
            (reference_time - _aware(match.kickoff_time)).total_seconds() / 86400,
        )
        weight = 0.5 ** (age_days / half_life_days)
        home_target, away_target = _target_goals(match)
        weighted_matches.append((match, weight, home_target, away_target))

    total_weight = sum(item[1] for item in weighted_matches)
    home_rate = sum(weight * home for _, weight, home, _ in weighted_matches) / total_weight
    away_rate = sum(weight * away for _, weight, _, away in weighted_matches) / total_weight
    base_rate = max(0.2, (home_rate + away_rate) / 2)
    home_advantage = max(0.7, min(1.6, home_rate / base_rate))

    team_totals: dict[str, dict[str, float]] = {}
    for match, weight, home_target, away_target in weighted_matches:
        for team in (match.home_team, match.away_team):
            team_totals.setdefault(
                team,
                {"weight": 0.0, "scored": 0.0, "conceded": 0.0, "matches": 0.0},
            )
        team_totals[match.home_team]["weight"] += weight
        team_totals[match.home_team]["scored"] += weight * home_target
        team_totals[match.home_team]["conceded"] += weight * away_target
        team_totals[match.home_team]["matches"] += 1
        team_totals[match.away_team]["weight"] += weight
        team_totals[match.away_team]["scored"] += weight * away_target
        team_totals[match.away_team]["conceded"] += weight * home_target
        team_totals[match.away_team]["matches"] += 1

    teams: dict[str, dict[str, float]] = {}
    for team, totals in team_totals.items():
        denominator = totals["weight"] + smoothing_matches
        scored_rate = (totals["scored"] + smoothing_matches * base_rate) / denominator
        conceded_rate = (totals["conceded"] + smoothing_matches * base_rate) / denominator
        teams[team] = {
            "attack": max(0.45, min(2.2, scored_rate / base_rate)),
            "defence_weakness": max(0.45, min(2.2, conceded_rate / base_rate)),
            "weighted_matches": float(totals["weight"]),
            "matches": int(totals["matches"]),
        }
    return {
        "base_goal_rate": float(base_rate),
        "home_advantage": float(home_advantage),
        "home_goal_rate": float(home_rate),
        "away_goal_rate": float(away_rate),
        "half_life_days": half_life_days,
        "smoothing_matches": smoothing_matches,
        "reference_time": reference_time.isoformat(),
        "target": "expected-goals-when-complete-otherwise-goals",
        "teams": teams,
    }


def predict_match(
    artifact: dict[str, Any],
    home_team: str,
    away_team: str,
) -> MatchProbabilityOutput:
    neutral = {"attack": 1.0, "defence_weakness": 1.0, "matches": 0}
    home = artifact["teams"].get(home_team, neutral)
    away = artifact["teams"].get(away_team, neutral)
    base_rate = artifact["base_goal_rate"]
    expected_home = max(
        0.15,
        min(
            4.5,
            base_rate
            * artifact["home_advantage"]
            * home["attack"]
            * away["defence_weakness"],
        ),
    )
    expected_away = max(
        0.15,
        min(4.5, base_rate * away["attack"] * home["defence_weakness"]),
    )

    home_win = draw = away_win = 0.0
    scorelines: list[dict[str, Any]] = []
    for home_goals in range(11):
        home_probability = _poisson_probability(home_goals, expected_home)
        for away_goals in range(11):
            probability = home_probability * _poisson_probability(away_goals, expected_away)
            if home_goals > away_goals:
                home_win += probability
            elif home_goals == away_goals:
                draw += probability
            else:
                away_win += probability
            if home_goals <= 6 and away_goals <= 6:
                scorelines.append(
                    {
                        "score": f"{home_goals}-{away_goals}",
                        "probability": probability,
                    }
                )
    outcome_total = home_win + draw + away_win
    scorelines.sort(key=lambda item: item["probability"], reverse=True)
    total_goals = expected_home + expected_away
    under_three = sum(_poisson_probability(goals, total_goals) for goals in range(3))
    return MatchProbabilityOutput(
        expected_home_goals=expected_home,
        expected_away_goals=expected_away,
        home_win_probability=home_win / outcome_total,
        draw_probability=draw / outcome_total,
        away_win_probability=away_win / outcome_total,
        home_clean_sheet_probability=math.exp(-expected_away),
        away_clean_sheet_probability=math.exp(-expected_home),
        both_teams_score_probability=(1 - math.exp(-expected_home))
        * (1 - math.exp(-expected_away)),
        over_two_five_probability=1 - under_three,
        scoreline_probabilities=[
            {
                "score": item["score"],
                "probability": round(float(item["probability"]), 6),
            }
            for item in scorelines[:8]
        ],
    )


def _evaluate(
    artifact: dict[str, Any],
    matches: list[TeamMatchObservation],
) -> dict[str, Any]:
    goal_errors: list[float] = []
    negative_log_likelihoods: list[float] = []
    outcome_briers: list[float] = []
    correct_outcomes = 0
    for match in matches:
        prediction = predict_match(artifact, match.home_team, match.away_team)
        actual_goals = [match.home_goals, match.away_goals]
        expected_goals = [prediction.expected_home_goals, prediction.expected_away_goals]
        goal_errors.extend(
            abs(actual - expected)
            for actual, expected in zip(actual_goals, expected_goals)
        )
        negative_log_likelihoods.extend(
            expected - actual * math.log(expected) + math.lgamma(actual + 1)
            for actual, expected in zip(actual_goals, expected_goals)
        )
        probabilities = np.asarray(
            [
                prediction.home_win_probability,
                prediction.draw_probability,
                prediction.away_win_probability,
            ]
        )
        actual_outcome = 0 if match.home_goals > match.away_goals else 1 if match.home_goals == match.away_goals else 2
        target = np.eye(3)[actual_outcome]
        outcome_briers.append(float(np.sum((probabilities - target) ** 2)))
        correct_outcomes += int(int(np.argmax(probabilities)) == actual_outcome)
    return {
        "test_matches": len(matches),
        "goals_mae": float(np.mean(goal_errors)),
        "poisson_negative_log_likelihood": float(np.mean(negative_log_likelihoods)),
        "outcome_brier_score": float(np.mean(outcome_briers)),
        "outcome_accuracy": correct_outcomes / len(matches),
    }


def _baseline_artifact(training: list[TeamMatchObservation]) -> dict[str, Any]:
    artifact = fit_team_strength_artifact(training)
    artifact["teams"] = {}
    return artifact


def train_team_strength(
    session: Session,
    dataset_ids: list[str],
    *,
    holdout_fraction: float = 0.2,
) -> ModelRun:
    datasets = list(
        session.scalars(select(HistoricalDataset).where(HistoricalDataset.id.in_(dataset_ids)))
    )
    if len(datasets) != len(set(dataset_ids)):
        raise TeamModelError("one or more historical datasets do not exist")
    matches = list(
        session.scalars(
            select(TeamMatchObservation)
            .where(TeamMatchObservation.dataset_id.in_(dataset_ids))
            .order_by(TeamMatchObservation.kickoff_time)
        )
    )
    time_keys = sorted({(match.season_id, match.gameweek) for match in matches})
    if len(time_keys) < 6:
        raise TeamModelError("at least six historical Gameweeks are required")
    split_index = max(4, int(len(time_keys) * (1 - holdout_fraction)))
    if split_index >= len(time_keys):
        split_index = len(time_keys) - 1
    training_keys = set(time_keys[:split_index])
    test_keys = set(time_keys[split_index:])
    training = [match for match in matches if (match.season_id, match.gameweek) in training_keys]
    test = [match for match in matches if (match.season_id, match.gameweek) in test_keys]
    artifact = fit_team_strength_artifact(training)
    metrics = _evaluate(artifact, test)
    baseline_metrics = _evaluate(_baseline_artifact(training), test)
    metrics["baseline"] = baseline_metrics
    metrics["verdict"] = (
        "beats-baseline"
        if metrics["goals_mae"] < baseline_metrics["goals_mae"]
        and metrics["outcome_brier_score"] < baseline_metrics["outcome_brier_score"]
        else "does-not-beat-baseline"
    )
    metrics["evaluation"] = "locked temporal holdout"
    run = ModelRun(
        id=str(uuid.uuid4()),
        model_type=MODEL_TYPE,
        model_version=MODEL_VERSION,
        created_at=datetime.now(timezone.utc),
        training_cutoff=max(_aware(match.kickoff_time) for match in training),
        validation_cutoff=max(_aware(match.kickoff_time) for match in test),
        feature_schema={
            "model": "independent Poisson scorelines",
            "features": [
                "time-decayed goals/xG",
                "team attack strength",
                "team defence weakness",
                "home advantage",
            ],
            "unknown_team_policy": "shrunk league-average prior",
        },
        artifact=artifact,
        metrics=metrics,
        dataset_checksums=[dataset.checksum for dataset in datasets],
        sample_count=len(matches),
        status="experimental",
    )
    session.add(run)
    session.commit()
    return run


def backtest_team_strength(
    session: Session,
    dataset_ids: list[str],
    *,
    initial_training_gameweeks: int = 6,
) -> BacktestReport:
    datasets = list(
        session.scalars(select(HistoricalDataset).where(HistoricalDataset.id.in_(dataset_ids)))
    )
    if len(datasets) != len(set(dataset_ids)):
        raise TeamModelError("one or more historical datasets do not exist")
    matches = list(
        session.scalars(
            select(TeamMatchObservation)
            .where(TeamMatchObservation.dataset_id.in_(dataset_ids))
            .order_by(TeamMatchObservation.kickoff_time)
        )
    )
    keys = sorted({(match.season_id, match.gameweek) for match in matches})
    if len(keys) <= initial_training_gameweeks:
        raise TeamModelError("not enough Gameweeks for an expanding team-model backtest")
    folds: list[dict[str, Any]] = []
    baseline_folds: list[dict[str, Any]] = []
    for index in range(initial_training_gameweeks, len(keys)):
        training_keys = set(keys[:index])
        test_key = keys[index]
        training = [match for match in matches if (match.season_id, match.gameweek) in training_keys]
        test = [match for match in matches if (match.season_id, match.gameweek) == test_key]
        if len(training) < 12 or not test:
            continue
        model_metrics = _evaluate(fit_team_strength_artifact(training), test)
        baseline_metrics = _evaluate(_baseline_artifact(training), test)
        folds.append(
            {
                "test_season": test_key[0],
                "test_gameweek": test_key[1],
                "training_matches": len(training),
                **model_metrics,
            }
        )
        baseline_folds.append(baseline_metrics)
    if not folds:
        raise TeamModelError("no valid team-model backtest folds were produced")

    total_matches = sum(fold["test_matches"] for fold in folds)
    metric_names = [
        "goals_mae",
        "poisson_negative_log_likelihood",
        "outcome_brier_score",
        "outcome_accuracy",
    ]
    aggregate = {
        "test_matches": total_matches,
        **{
            name: sum(fold[name] * fold["test_matches"] for fold in folds) / total_matches
            for name in metric_names
        },
    }
    baseline = {
        "test_matches": total_matches,
        **{
            name: sum(fold[name] * fold["test_matches"] for fold in baseline_folds)
            / total_matches
            for name in metric_names
        },
    }
    verdict = (
        "beats-baseline"
        if aggregate["goals_mae"] < baseline["goals_mae"]
        and aggregate["outcome_brier_score"] < baseline["outcome_brier_score"]
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
            "split": "expanding-window by season and Gameweek",
        },
        fold_metrics=folds,
        aggregate_metrics=aggregate,
        baseline_metrics=baseline,
        verdict=verdict,
        sample_count=total_matches,
        status="experimental",
    )
    session.add(report)
    session.commit()
    return report


def generate_match_forecasts(
    session: Session,
    model_run_id: Optional[str] = None,
) -> list[MatchForecast]:
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
        raise TeamModelError("no team-strength model run is available")
    snapshot = session.scalar(
        select(RawSnapshot)
        .where(RawSnapshot.ingestion_status == "succeeded")
        .order_by(desc(RawSnapshot.retrieved_at))
        .limit(1)
    )
    if not snapshot:
        raise TeamModelError("no successful current snapshot is available")
    teams = {
        team.source_id: team.short_name
        for team in session.scalars(
            select(TeamSnapshot).where(TeamSnapshot.snapshot_id == snapshot.id)
        )
    }
    fixtures = list(
        session.scalars(
            select(FixtureSnapshot)
            .where(
                FixtureSnapshot.snapshot_id == snapshot.id,
                FixtureSnapshot.finished.is_(False),
            )
            .order_by(FixtureSnapshot.kickoff_time)
        )
    )
    generated_at = datetime.now(timezone.utc)
    forecasts: list[MatchForecast] = []
    for fixture in fixtures:
        if fixture.kickoff_time:
            training_cutoff = _aware(model_run.training_cutoff)
            if training_cutoff >= _aware(fixture.kickoff_time):
                raise TeamModelError(
                    "team-model training cutoff must be earlier than every forecast fixture"
                )
        existing = session.scalar(
            select(MatchForecast).where(
                MatchForecast.model_run_id == model_run.id,
                MatchForecast.snapshot_id == snapshot.id,
                MatchForecast.fixture_source_id == fixture.source_id,
            )
        )
        if existing:
            forecasts.append(existing)
            continue
        home_team = teams.get(fixture.home_team_source_id, str(fixture.home_team_source_id))
        away_team = teams.get(fixture.away_team_source_id, str(fixture.away_team_source_id))
        prediction = predict_match(model_run.artifact, home_team, away_team)
        home_matches = model_run.artifact["teams"].get(home_team, {}).get("matches", 0)
        away_matches = model_run.artifact["teams"].get(away_team, {}).get("matches", 0)
        confidence = min(0.9, 0.35 + min(home_matches, away_matches, 12) * 0.04)
        reasons = [
            f"{home_team} attack and defence use {home_matches} historical matches",
            f"{away_team} attack and defence use {away_matches} historical matches",
            f"home advantage multiplier {model_run.artifact['home_advantage']:.2f}",
        ]
        if not home_matches or not away_matches:
            reasons.append("a promoted or unmatched team uses a shrunk league-average prior")
        forecast = MatchForecast(
            model_run_id=model_run.id,
            snapshot_id=snapshot.id,
            fixture_source_id=fixture.source_id,
            generated_at=generated_at,
            home_team=home_team,
            away_team=away_team,
            expected_home_goals=prediction.expected_home_goals,
            expected_away_goals=prediction.expected_away_goals,
            home_win_probability=prediction.home_win_probability,
            draw_probability=prediction.draw_probability,
            away_win_probability=prediction.away_win_probability,
            home_clean_sheet_probability=prediction.home_clean_sheet_probability,
            away_clean_sheet_probability=prediction.away_clean_sheet_probability,
            both_teams_score_probability=prediction.both_teams_score_probability,
            over_two_five_probability=prediction.over_two_five_probability,
            scoreline_probabilities=prediction.scoreline_probabilities,
            confidence=confidence,
            reasons=reasons,
        )
        session.add(forecast)
        forecasts.append(forecast)
    session.commit()
    return forecasts
