"""Add cross-season player identity and expanding backtests.

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-29
"""

from collections.abc import Sequence
from typing import Optional, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Optional[str] = "0002"
branch_labels: Optional[Union[str, Sequence[str]]] = None
depends_on: Optional[Union[str, Sequence[str]]] = None


def upgrade() -> None:
    op.create_table(
        "player_identities",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("canonical_name", sa.String(length=128), nullable=False),
        sa.Column("normalized_name", sa.String(length=128), nullable=False),
        sa.Column("primary_position", sa.String(length=8), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
    )
    op.create_index(
        "ix_player_identity_normalized_name",
        "player_identities",
        ["normalized_name"],
    )
    op.create_table(
        "player_identity_aliases",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("player_identity_id", sa.String(length=36), nullable=True),
        sa.Column("source", sa.String(length=96), nullable=False),
        sa.Column("season_id", sa.String(length=16), nullable=False),
        sa.Column("source_player_id", sa.Integer(), nullable=False),
        sa.Column("source_name", sa.String(length=128), nullable=False),
        sa.Column("normalized_name", sa.String(length=128), nullable=False),
        sa.Column("position", sa.String(length=8), nullable=False),
        sa.Column("match_method", sa.String(length=48), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("review_status", sa.String(length=24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["player_identity_id"], ["player_identities.id"]),
        sa.UniqueConstraint(
            "source",
            "season_id",
            "source_player_id",
            name="uq_player_identity_alias_source",
        ),
    )
    op.create_table(
        "snapshot_player_identities",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("snapshot_id", sa.String(length=36), nullable=False),
        sa.Column("player_source_id", sa.Integer(), nullable=False),
        sa.Column("player_identity_id", sa.String(length=36), nullable=True),
        sa.Column("normalized_name", sa.String(length=128), nullable=False),
        sa.Column("match_method", sa.String(length=48), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("review_status", sa.String(length=24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["player_identity_id"], ["player_identities.id"]),
        sa.ForeignKeyConstraint(["snapshot_id"], ["raw_snapshots.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("snapshot_id", "player_source_id", name="uq_snapshot_player_identity"),
    )
    op.create_index(
        "ix_snapshot_player_identity_status",
        "snapshot_player_identities",
        ["snapshot_id", "review_status"],
    )
    with op.batch_alter_table("player_gameweek_observations") as batch_op:
        batch_op.add_column(sa.Column("player_identity_id", sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            "fk_observation_player_identity",
            "player_identities",
            ["player_identity_id"],
            ["id"],
        )
        batch_op.create_index(
            "ix_observation_identity_time",
            ["player_identity_id", "kickoff_time"],
        )
    op.create_table(
        "backtest_reports",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("model_type", sa.String(length=64), nullable=False),
        sa.Column("model_version", sa.String(length=64), nullable=False),
        sa.Column("baseline_version", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dataset_checksums", sa.JSON(), nullable=False),
        sa.Column("configuration", sa.JSON(), nullable=False),
        sa.Column("fold_metrics", sa.JSON(), nullable=False),
        sa.Column("aggregate_metrics", sa.JSON(), nullable=False),
        sa.Column("baseline_metrics", sa.JSON(), nullable=False),
        sa.Column("verdict", sa.String(length=32), nullable=False),
        sa.Column("sample_count", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
    )
    op.create_index("ix_backtest_model_created", "backtest_reports", ["model_type", "created_at"])
    with op.batch_alter_table("expected_minutes_forecasts") as batch_op:
        batch_op.add_column(sa.Column("player_identity_id", sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            "fk_forecast_player_identity",
            "player_identities",
            ["player_identity_id"],
            ["id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("expected_minutes_forecasts") as batch_op:
        batch_op.drop_constraint("fk_forecast_player_identity", type_="foreignkey")
        batch_op.drop_column("player_identity_id")
    op.drop_index("ix_backtest_model_created", table_name="backtest_reports")
    op.drop_table("backtest_reports")
    with op.batch_alter_table("player_gameweek_observations") as batch_op:
        batch_op.drop_index("ix_observation_identity_time")
        batch_op.drop_constraint("fk_observation_player_identity", type_="foreignkey")
        batch_op.drop_column("player_identity_id")
    op.drop_index("ix_snapshot_player_identity_status", table_name="snapshot_player_identities")
    op.drop_table("snapshot_player_identities")
    op.drop_table("player_identity_aliases")
    op.drop_index("ix_player_identity_normalized_name", table_name="player_identities")
    op.drop_table("player_identities")
