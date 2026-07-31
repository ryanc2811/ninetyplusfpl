from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class Season(Base):
    __tablename__ = "seasons"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    name: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    start_year: Mapped[int] = mapped_column(Integer, nullable=False)
    rules_version: Mapped[str] = mapped_column(String(32), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Gameweek(Base):
    __tablename__ = "gameweeks"
    __table_args__ = (UniqueConstraint("season_id", "number", name="uq_gameweek_season_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    season_id: Mapped[str] = mapped_column(ForeignKey("seasons.id", ondelete="CASCADE"), nullable=False)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    deadline_time: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    is_finished: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class RawSnapshot(Base):
    __tablename__ = "raw_snapshots"
    __table_args__ = (
        UniqueConstraint("source", "checksum", name="uq_snapshot_source_checksum"),
        Index("ix_snapshot_season_gameweek_retrieved", "season_id", "gameweek", "retrieved_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    season_id: Mapped[str] = mapped_column(ForeignKey("seasons.id"), nullable=False)
    gameweek: Mapped[int] = mapped_column(Integer, nullable=False)
    request_parameters: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    source_event_timestamp: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    checksum: Mapped[str] = mapped_column(String(64), nullable=False)
    schema_version: Mapped[str] = mapped_column(String(32), nullable=False)
    ingestion_status: Mapped[str] = mapped_column(String(24), nullable=False)
    raw_payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    error_message: Mapped[Optional[str]] = mapped_column(Text)


class TeamSnapshot(Base):
    __tablename__ = "team_snapshots"
    __table_args__ = (UniqueConstraint("snapshot_id", "source_id", name="uq_team_snapshot_source"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    snapshot_id: Mapped[str] = mapped_column(ForeignKey("raw_snapshots.id", ondelete="CASCADE"), nullable=False)
    source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(96), nullable=False)
    short_name: Mapped[str] = mapped_column(String(8), nullable=False)
    strength: Mapped[Optional[int]] = mapped_column(Integer)


class PlayerSnapshot(Base):
    __tablename__ = "player_snapshots"
    __table_args__ = (
        UniqueConstraint("snapshot_id", "source_id", name="uq_player_snapshot_source"),
        Index("ix_player_snapshot_position_price", "snapshot_id", "position", "price"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    snapshot_id: Mapped[str] = mapped_column(ForeignKey("raw_snapshots.id", ondelete="CASCADE"), nullable=False)
    source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    team_source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    web_name: Mapped[str] = mapped_column(String(96), nullable=False)
    first_name: Mapped[str] = mapped_column(String(96), nullable=False, default="")
    second_name: Mapped[str] = mapped_column(String(96), nullable=False, default="")
    position: Mapped[str] = mapped_column(String(8), nullable=False)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(String(8), nullable=False)
    chance_next_round: Mapped[Optional[int]] = mapped_column(Integer)
    minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    starts: Mapped[int] = mapped_column(Integer, nullable=False)
    total_points: Mapped[int] = mapped_column(Integer, nullable=False)
    form: Mapped[float] = mapped_column(Float, nullable=False)
    selected_by_percent: Mapped[float] = mapped_column(Float, nullable=False)
    expected_goals_per_90: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    expected_assists_per_90: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    clean_sheets_per_90: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    saves_per_90: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    yellow_cards_per_90: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    bps_per_90: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    bonus_per_90: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    defensive_contribution_per_90: Mapped[float] = mapped_column(Float, nullable=False, default=0)


class FixtureSnapshot(Base):
    __tablename__ = "fixture_snapshots"
    __table_args__ = (
        UniqueConstraint("snapshot_id", "source_id", name="uq_fixture_snapshot_source"),
        Index("ix_fixture_snapshot_event", "snapshot_id", "event"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    snapshot_id: Mapped[str] = mapped_column(ForeignKey("raw_snapshots.id", ondelete="CASCADE"), nullable=False)
    source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    event: Mapped[Optional[int]] = mapped_column(Integer)
    home_team_source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    away_team_source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    home_difficulty: Mapped[int] = mapped_column(Integer, nullable=False)
    away_difficulty: Mapped[int] = mapped_column(Integer, nullable=False)
    kickoff_time: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    started: Mapped[bool] = mapped_column(Boolean, nullable=False)
    finished: Mapped[bool] = mapped_column(Boolean, nullable=False)


class HistoricalDataset(Base):
    __tablename__ = "historical_datasets"
    __table_args__ = (UniqueConstraint("source", "checksum", name="uq_historical_dataset_source_checksum"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source: Mapped[str] = mapped_column(String(96), nullable=False)
    source_uri: Mapped[str] = mapped_column(String(512), nullable=False)
    retrieved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    season_id: Mapped[str] = mapped_column(String(16), nullable=False)
    checksum: Mapped[str] = mapped_column(String(64), nullable=False)
    schema_version: Mapped[str] = mapped_column(String(32), nullable=False)
    license_status: Mapped[str] = mapped_column(String(32), nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False)


class PlayerIdentity(Base):
    __tablename__ = "player_identities"
    __table_args__ = (Index("ix_player_identity_normalized_name", "normalized_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    canonical_name: Mapped[str] = mapped_column(String(128), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(128), nullable=False)
    primary_position: Mapped[str] = mapped_column(String(8), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)


class PlayerIdentityAlias(Base):
    __tablename__ = "player_identity_aliases"
    __table_args__ = (
        UniqueConstraint(
            "source",
            "season_id",
            "source_player_id",
            name="uq_player_identity_alias_source",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    player_identity_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("player_identities.id"),
        nullable=True,
    )
    source: Mapped[str] = mapped_column(String(96), nullable=False)
    season_id: Mapped[str] = mapped_column(String(16), nullable=False)
    source_player_id: Mapped[int] = mapped_column(Integer, nullable=False)
    source_name: Mapped[str] = mapped_column(String(128), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(128), nullable=False)
    position: Mapped[str] = mapped_column(String(8), nullable=False)
    match_method: Mapped[str] = mapped_column(String(48), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    review_status: Mapped[str] = mapped_column(String(24), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SnapshotPlayerIdentity(Base):
    __tablename__ = "snapshot_player_identities"
    __table_args__ = (
        UniqueConstraint("snapshot_id", "player_source_id", name="uq_snapshot_player_identity"),
        Index("ix_snapshot_player_identity_status", "snapshot_id", "review_status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    snapshot_id: Mapped[str] = mapped_column(
        ForeignKey("raw_snapshots.id", ondelete="CASCADE"),
        nullable=False,
    )
    player_source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    player_identity_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("player_identities.id"),
        nullable=True,
    )
    normalized_name: Mapped[str] = mapped_column(String(128), nullable=False)
    match_method: Mapped[str] = mapped_column(String(48), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    review_status: Mapped[str] = mapped_column(String(24), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PlayerGameweekObservation(Base):
    __tablename__ = "player_gameweek_observations"
    __table_args__ = (
        UniqueConstraint("dataset_id", "row_checksum", name="uq_observation_dataset_row"),
        Index("ix_observation_player_time", "season_id", "player_source_id", "gameweek"),
        Index("ix_observation_identity_time", "player_identity_id", "kickoff_time"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dataset_id: Mapped[str] = mapped_column(
        ForeignKey("historical_datasets.id", ondelete="CASCADE"),
        nullable=False,
    )
    player_identity_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("player_identities.id"),
        nullable=True,
    )
    season_id: Mapped[str] = mapped_column(String(16), nullable=False)
    gameweek: Mapped[int] = mapped_column(Integer, nullable=False)
    player_source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    player_name: Mapped[str] = mapped_column(String(128), nullable=False)
    position: Mapped[str] = mapped_column(String(8), nullable=False)
    team_name: Mapped[str] = mapped_column(String(96), nullable=False)
    opponent_name: Mapped[str] = mapped_column(String(96), nullable=False)
    fixture_source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    kickoff_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    was_home: Mapped[bool] = mapped_column(Boolean, nullable=False)
    difficulty: Mapped[int] = mapped_column(Integer, nullable=False)
    minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    started: Mapped[bool] = mapped_column(Boolean, nullable=False)
    start_inferred: Mapped[bool] = mapped_column(Boolean, nullable=False)
    total_points: Mapped[int] = mapped_column(Integer, nullable=False)
    goals_scored: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    assists: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    clean_sheets: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    saves: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    yellow_cards: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    bonus: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    bps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    defensive_contributions: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    row_checksum: Mapped[str] = mapped_column(String(64), nullable=False)


class TeamMatchObservation(Base):
    __tablename__ = "team_match_observations"
    __table_args__ = (
        UniqueConstraint("dataset_id", "row_checksum", name="uq_team_match_dataset_row"),
        Index("ix_team_match_kickoff", "kickoff_time"),
        Index("ix_team_match_teams", "home_team", "away_team"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dataset_id: Mapped[str] = mapped_column(
        ForeignKey("historical_datasets.id", ondelete="CASCADE"),
        nullable=False,
    )
    season_id: Mapped[str] = mapped_column(String(16), nullable=False)
    gameweek: Mapped[int] = mapped_column(Integer, nullable=False)
    fixture_source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    kickoff_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    home_team: Mapped[str] = mapped_column(String(96), nullable=False)
    away_team: Mapped[str] = mapped_column(String(96), nullable=False)
    home_goals: Mapped[int] = mapped_column(Integer, nullable=False)
    away_goals: Mapped[int] = mapped_column(Integer, nullable=False)
    home_expected_goals: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    away_expected_goals: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    row_checksum: Mapped[str] = mapped_column(String(64), nullable=False)


class ModelRun(Base):
    __tablename__ = "model_runs"
    __table_args__ = (Index("ix_model_run_type_created", "model_type", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    model_type: Mapped[str] = mapped_column(String(64), nullable=False)
    model_version: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    training_cutoff: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    validation_cutoff: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    feature_schema: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    artifact: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    dataset_checksums: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    sample_count: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)


class BacktestReport(Base):
    __tablename__ = "backtest_reports"
    __table_args__ = (Index("ix_backtest_model_created", "model_type", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    model_type: Mapped[str] = mapped_column(String(64), nullable=False)
    model_version: Mapped[str] = mapped_column(String(64), nullable=False)
    baseline_version: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    dataset_checksums: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    configuration: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    fold_metrics: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    aggregate_metrics: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    baseline_metrics: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    verdict: Mapped[str] = mapped_column(String(32), nullable=False)
    sample_count: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)


class ExpectedMinutesForecast(Base):
    __tablename__ = "expected_minutes_forecasts"
    __table_args__ = (
        UniqueConstraint(
            "model_run_id",
            "snapshot_id",
            "player_source_id",
            name="uq_expected_minutes_forecast",
        ),
        Index("ix_expected_minutes_snapshot", "snapshot_id", "generated_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    model_run_id: Mapped[str] = mapped_column(ForeignKey("model_runs.id"), nullable=False)
    snapshot_id: Mapped[str] = mapped_column(ForeignKey("raw_snapshots.id"), nullable=False)
    player_source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    player_identity_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("player_identities.id"),
        nullable=True,
    )
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    start_probability: Mapped[float] = mapped_column(Float, nullable=False)
    substitute_probability: Mapped[float] = mapped_column(Float, nullable=False)
    zero_minutes_probability: Mapped[float] = mapped_column(Float, nullable=False)
    expected_minutes_if_start: Mapped[float] = mapped_column(Float, nullable=False)
    expected_minutes_if_substitute: Mapped[float] = mapped_column(Float, nullable=False)
    expected_minutes: Mapped[float] = mapped_column(Float, nullable=False)
    sixty_minute_probability: Mapped[float] = mapped_column(Float, nullable=False)
    early_substitution_probability: Mapped[float] = mapped_column(Float, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    features: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    reasons: Mapped[list[str]] = mapped_column(JSON, nullable=False)


class MatchForecast(Base):
    __tablename__ = "match_forecasts"
    __table_args__ = (
        UniqueConstraint(
            "model_run_id",
            "snapshot_id",
            "fixture_source_id",
            name="uq_match_forecast",
        ),
        Index("ix_match_forecast_snapshot", "snapshot_id", "generated_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    model_run_id: Mapped[str] = mapped_column(ForeignKey("model_runs.id"), nullable=False)
    snapshot_id: Mapped[str] = mapped_column(ForeignKey("raw_snapshots.id"), nullable=False)
    fixture_source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    home_team: Mapped[str] = mapped_column(String(96), nullable=False)
    away_team: Mapped[str] = mapped_column(String(96), nullable=False)
    expected_home_goals: Mapped[float] = mapped_column(Float, nullable=False)
    expected_away_goals: Mapped[float] = mapped_column(Float, nullable=False)
    home_win_probability: Mapped[float] = mapped_column(Float, nullable=False)
    draw_probability: Mapped[float] = mapped_column(Float, nullable=False)
    away_win_probability: Mapped[float] = mapped_column(Float, nullable=False)
    home_clean_sheet_probability: Mapped[float] = mapped_column(Float, nullable=False)
    away_clean_sheet_probability: Mapped[float] = mapped_column(Float, nullable=False)
    both_teams_score_probability: Mapped[float] = mapped_column(Float, nullable=False)
    over_two_five_probability: Mapped[float] = mapped_column(Float, nullable=False)
    scoreline_probabilities: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    reasons: Mapped[list[str]] = mapped_column(JSON, nullable=False)


class PlayerPointsForecast(Base):
    __tablename__ = "player_points_forecasts"
    __table_args__ = (
        UniqueConstraint(
            "simulation_id",
            "player_source_id",
            "fixture_source_id",
            name="uq_player_points_forecast",
        ),
        Index("ix_player_points_snapshot_generated", "snapshot_id", "generated_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    simulation_id: Mapped[str] = mapped_column(String(36), nullable=False)
    snapshot_id: Mapped[str] = mapped_column(ForeignKey("raw_snapshots.id"), nullable=False)
    fixture_source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    event: Mapped[int] = mapped_column(Integer, nullable=False)
    player_source_id: Mapped[int] = mapped_column(Integer, nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    model_version: Mapped[str] = mapped_column(String(64), nullable=False)
    rules_version: Mapped[str] = mapped_column(String(32), nullable=False)
    simulation_count: Mapped[int] = mapped_column(Integer, nullable=False)
    seed: Mapped[int] = mapped_column(Integer, nullable=False)
    expected_points: Mapped[float] = mapped_column(Float, nullable=False)
    median_points: Mapped[float] = mapped_column(Float, nullable=False)
    p10_points: Mapped[float] = mapped_column(Float, nullable=False)
    p90_points: Mapped[float] = mapped_column(Float, nullable=False)
    two_plus_probability: Mapped[float] = mapped_column(Float, nullable=False)
    five_plus_probability: Mapped[float] = mapped_column(Float, nullable=False)
    ten_plus_probability: Mapped[float] = mapped_column(Float, nullable=False)
    fifteen_plus_probability: Mapped[float] = mapped_column(Float, nullable=False)
    goal_probability: Mapped[float] = mapped_column(Float, nullable=False)
    assist_probability: Mapped[float] = mapped_column(Float, nullable=False)
    clean_sheet_probability: Mapped[float] = mapped_column(Float, nullable=False)
    bonus_probability: Mapped[float] = mapped_column(Float, nullable=False)
    defensive_contribution_probability: Mapped[float] = mapped_column(Float, nullable=False)
    expected_bonus: Mapped[float] = mapped_column(Float, nullable=False)
    expected_defensive_contribution_points: Mapped[float] = mapped_column(Float, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    event_priors: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    lineage: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    reasons: Mapped[list[str]] = mapped_column(JSON, nullable=False)
