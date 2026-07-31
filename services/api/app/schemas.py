from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict


class SnapshotSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source: str
    retrieved_at: datetime
    season_id: str
    gameweek: int
    checksum: str
    schema_version: str
    ingestion_status: str
    player_count: int
    team_count: int
    fixture_count: int
    created: bool = True


class PlayerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    source_id: int
    team_source_id: int
    web_name: str
    first_name: str
    second_name: str
    position: str
    price: float
    status: str
    chance_next_round: Optional[int]
    minutes: int
    starts: int
    total_points: int
    form: float
    selected_by_percent: float
    expected_goals_per_90: float
    expected_assists_per_90: float
    clean_sheets_per_90: float
    saves_per_90: float
    yellow_cards_per_90: float
    bps_per_90: float
    bonus_per_90: float
    defensive_contribution_per_90: float


class SnapshotExport(BaseModel):
    snapshot_id: str
    provenance: dict[str, Any]
    bootstrap: dict[str, Any]
    fixtures: list[dict[str, Any]]


class ModelTrainRequest(BaseModel):
    dataset_ids: list[str]
    minimum_history: int = 3


class BacktestRequest(BaseModel):
    dataset_ids: list[str]
    minimum_history: int = 3
    initial_training_gameweeks: int = 6
    calibration_gameweeks: int = 2


class ModelRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    model_type: str
    model_version: str
    created_at: datetime
    training_cutoff: datetime
    validation_cutoff: datetime
    feature_schema: dict[str, Any]
    metrics: dict[str, Any]
    dataset_checksums: list[str]
    sample_count: int
    status: str


class ExpectedMinutesForecastRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    model_run_id: str
    snapshot_id: str
    player_source_id: int
    player_identity_id: Optional[str]
    generated_at: datetime
    start_probability: float
    substitute_probability: float
    zero_minutes_probability: float
    expected_minutes_if_start: float
    expected_minutes_if_substitute: float
    expected_minutes: float
    sixty_minute_probability: float
    early_substitution_probability: float
    confidence: float
    features: dict[str, Any]
    reasons: list[str]


class BacktestReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    model_type: str
    model_version: str
    baseline_version: str
    created_at: datetime
    dataset_checksums: list[str]
    configuration: dict[str, Any]
    fold_metrics: list[dict[str, Any]]
    aggregate_metrics: dict[str, Any]
    baseline_metrics: dict[str, Any]
    verdict: str
    sample_count: int
    status: str


class IdentityCoverageRead(BaseModel):
    snapshot_id: str
    total: int
    resolved: int
    automatic: int
    review_required: int
    unresolved: int


class TeamBacktestRequest(BaseModel):
    dataset_ids: list[str]
    initial_training_gameweeks: int = 6


class MatchForecastRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    model_run_id: str
    snapshot_id: str
    fixture_source_id: int
    generated_at: datetime
    home_team: str
    away_team: str
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
    confidence: float
    reasons: list[str]


class PlayerPointsForecastRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    simulation_id: str
    snapshot_id: str
    fixture_source_id: int
    event: int
    player_source_id: int
    generated_at: datetime
    model_version: str
    rules_version: str
    simulation_count: int
    seed: int
    expected_points: float
    median_points: float
    p10_points: float
    p90_points: float
    two_plus_probability: float
    five_plus_probability: float
    ten_plus_probability: float
    fifteen_plus_probability: float
    goal_probability: float
    assist_probability: float
    clean_sheet_probability: float
    bonus_probability: float
    defensive_contribution_probability: float
    expected_bonus: float
    expected_defensive_contribution_points: float
    confidence: float
    event_priors: dict[str, Any]
    lineage: dict[str, Any]
    reasons: list[str]
