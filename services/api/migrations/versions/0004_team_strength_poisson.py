"""Add historical team matches and Poisson forecasts.

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-29
"""

from collections.abc import Sequence
from typing import Optional, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Optional[str] = "0003"
branch_labels: Optional[Union[str, Sequence[str]]] = None
depends_on: Optional[Union[str, Sequence[str]]] = None


def upgrade() -> None:
    op.create_table(
        "team_match_observations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("dataset_id", sa.String(length=36), nullable=False),
        sa.Column("season_id", sa.String(length=16), nullable=False),
        sa.Column("gameweek", sa.Integer(), nullable=False),
        sa.Column("fixture_source_id", sa.Integer(), nullable=False),
        sa.Column("kickoff_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("home_team", sa.String(length=96), nullable=False),
        sa.Column("away_team", sa.String(length=96), nullable=False),
        sa.Column("home_goals", sa.Integer(), nullable=False),
        sa.Column("away_goals", sa.Integer(), nullable=False),
        sa.Column("home_expected_goals", sa.Float(), nullable=True),
        sa.Column("away_expected_goals", sa.Float(), nullable=True),
        sa.Column("row_checksum", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(["dataset_id"], ["historical_datasets.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("dataset_id", "row_checksum", name="uq_team_match_dataset_row"),
    )
    op.create_index("ix_team_match_kickoff", "team_match_observations", ["kickoff_time"])
    op.create_index(
        "ix_team_match_teams",
        "team_match_observations",
        ["home_team", "away_team"],
    )
    op.create_table(
        "match_forecasts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("model_run_id", sa.String(length=36), nullable=False),
        sa.Column("snapshot_id", sa.String(length=36), nullable=False),
        sa.Column("fixture_source_id", sa.Integer(), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("home_team", sa.String(length=96), nullable=False),
        sa.Column("away_team", sa.String(length=96), nullable=False),
        sa.Column("expected_home_goals", sa.Float(), nullable=False),
        sa.Column("expected_away_goals", sa.Float(), nullable=False),
        sa.Column("home_win_probability", sa.Float(), nullable=False),
        sa.Column("draw_probability", sa.Float(), nullable=False),
        sa.Column("away_win_probability", sa.Float(), nullable=False),
        sa.Column("home_clean_sheet_probability", sa.Float(), nullable=False),
        sa.Column("away_clean_sheet_probability", sa.Float(), nullable=False),
        sa.Column("both_teams_score_probability", sa.Float(), nullable=False),
        sa.Column("over_two_five_probability", sa.Float(), nullable=False),
        sa.Column("scoreline_probabilities", sa.JSON(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("reasons", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["model_run_id"], ["model_runs.id"]),
        sa.ForeignKeyConstraint(["snapshot_id"], ["raw_snapshots.id"]),
        sa.UniqueConstraint(
            "model_run_id",
            "snapshot_id",
            "fixture_source_id",
            name="uq_match_forecast",
        ),
    )
    op.create_index(
        "ix_match_forecast_snapshot",
        "match_forecasts",
        ["snapshot_id", "generated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_match_forecast_snapshot", table_name="match_forecasts")
    op.drop_table("match_forecasts")
    op.drop_index("ix_team_match_teams", table_name="team_match_observations")
    op.drop_index("ix_team_match_kickoff", table_name="team_match_observations")
    op.drop_table("team_match_observations")
