"""Add historical observations and expected-minutes model lineage.

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-29
"""

from collections.abc import Sequence
from typing import Optional, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Optional[str] = "0001"
branch_labels: Optional[Union[str, Sequence[str]]] = None
depends_on: Optional[Union[str, Sequence[str]]] = None


def upgrade() -> None:
    op.create_table(
        "historical_datasets",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("source", sa.String(length=96), nullable=False),
        sa.Column("source_uri", sa.String(length=512), nullable=False),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("season_id", sa.String(length=16), nullable=False),
        sa.Column("checksum", sa.String(length=64), nullable=False),
        sa.Column("schema_version", sa.String(length=32), nullable=False),
        sa.Column("license_status", sa.String(length=32), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.UniqueConstraint("source", "checksum", name="uq_historical_dataset_source_checksum"),
    )
    op.create_table(
        "player_gameweek_observations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("dataset_id", sa.String(length=36), nullable=False),
        sa.Column("season_id", sa.String(length=16), nullable=False),
        sa.Column("gameweek", sa.Integer(), nullable=False),
        sa.Column("player_source_id", sa.Integer(), nullable=False),
        sa.Column("player_name", sa.String(length=128), nullable=False),
        sa.Column("position", sa.String(length=8), nullable=False),
        sa.Column("team_name", sa.String(length=96), nullable=False),
        sa.Column("opponent_name", sa.String(length=96), nullable=False),
        sa.Column("fixture_source_id", sa.Integer(), nullable=False),
        sa.Column("kickoff_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("was_home", sa.Boolean(), nullable=False),
        sa.Column("difficulty", sa.Integer(), nullable=False),
        sa.Column("minutes", sa.Integer(), nullable=False),
        sa.Column("started", sa.Boolean(), nullable=False),
        sa.Column("start_inferred", sa.Boolean(), nullable=False),
        sa.Column("total_points", sa.Integer(), nullable=False),
        sa.Column("row_checksum", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["dataset_id"], ["historical_datasets.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("dataset_id", "row_checksum", name="uq_observation_dataset_row"),
    )
    op.create_index(
        "ix_observation_player_time",
        "player_gameweek_observations",
        ["season_id", "player_source_id", "gameweek"],
    )
    op.create_table(
        "model_runs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("model_type", sa.String(length=64), nullable=False),
        sa.Column("model_version", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("training_cutoff", sa.DateTime(timezone=True), nullable=False),
        sa.Column("validation_cutoff", sa.DateTime(timezone=True), nullable=False),
        sa.Column("feature_schema", sa.JSON(), nullable=False),
        sa.Column("artifact", sa.JSON(), nullable=False),
        sa.Column("metrics", sa.JSON(), nullable=False),
        sa.Column("dataset_checksums", sa.JSON(), nullable=False),
        sa.Column("sample_count", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
    )
    op.create_index("ix_model_run_type_created", "model_runs", ["model_type", "created_at"])
    op.create_table(
        "expected_minutes_forecasts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("model_run_id", sa.String(length=36), nullable=False),
        sa.Column("snapshot_id", sa.String(length=36), nullable=False),
        sa.Column("player_source_id", sa.Integer(), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("start_probability", sa.Float(), nullable=False),
        sa.Column("substitute_probability", sa.Float(), nullable=False),
        sa.Column("zero_minutes_probability", sa.Float(), nullable=False),
        sa.Column("expected_minutes_if_start", sa.Float(), nullable=False),
        sa.Column("expected_minutes_if_substitute", sa.Float(), nullable=False),
        sa.Column("expected_minutes", sa.Float(), nullable=False),
        sa.Column("sixty_minute_probability", sa.Float(), nullable=False),
        sa.Column("early_substitution_probability", sa.Float(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("features", sa.JSON(), nullable=False),
        sa.Column("reasons", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["model_run_id"], ["model_runs.id"]),
        sa.ForeignKeyConstraint(["snapshot_id"], ["raw_snapshots.id"]),
        sa.UniqueConstraint(
            "model_run_id",
            "snapshot_id",
            "player_source_id",
            name="uq_expected_minutes_forecast",
        ),
    )
    op.create_index(
        "ix_expected_minutes_snapshot",
        "expected_minutes_forecasts",
        ["snapshot_id", "generated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_expected_minutes_snapshot", table_name="expected_minutes_forecasts")
    op.drop_table("expected_minutes_forecasts")
    op.drop_index("ix_model_run_type_created", table_name="model_runs")
    op.drop_table("model_runs")
    op.drop_index("ix_observation_player_time", table_name="player_gameweek_observations")
    op.drop_table("player_gameweek_observations")
    op.drop_table("historical_datasets")
