"""Add player event rates and probabilistic points forecasts.

Revision ID: 0005
Revises: 0004
"""

from alembic import op
import sqlalchemy as sa


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name in (
        "expected_goals_per_90",
        "expected_assists_per_90",
        "clean_sheets_per_90",
        "saves_per_90",
        "yellow_cards_per_90",
        "bps_per_90",
        "bonus_per_90",
        "defensive_contribution_per_90",
    ):
        op.add_column(
            "player_snapshots",
            sa.Column(name, sa.Float(), nullable=False, server_default="0"),
        )

    op.create_table(
        "player_points_forecasts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("simulation_id", sa.String(length=36), nullable=False),
        sa.Column("snapshot_id", sa.String(length=36), nullable=False),
        sa.Column("fixture_source_id", sa.Integer(), nullable=False),
        sa.Column("event", sa.Integer(), nullable=False),
        sa.Column("player_source_id", sa.Integer(), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("model_version", sa.String(length=64), nullable=False),
        sa.Column("rules_version", sa.String(length=32), nullable=False),
        sa.Column("simulation_count", sa.Integer(), nullable=False),
        sa.Column("seed", sa.Integer(), nullable=False),
        sa.Column("expected_points", sa.Float(), nullable=False),
        sa.Column("median_points", sa.Float(), nullable=False),
        sa.Column("p10_points", sa.Float(), nullable=False),
        sa.Column("p90_points", sa.Float(), nullable=False),
        sa.Column("two_plus_probability", sa.Float(), nullable=False),
        sa.Column("five_plus_probability", sa.Float(), nullable=False),
        sa.Column("ten_plus_probability", sa.Float(), nullable=False),
        sa.Column("fifteen_plus_probability", sa.Float(), nullable=False),
        sa.Column("goal_probability", sa.Float(), nullable=False),
        sa.Column("assist_probability", sa.Float(), nullable=False),
        sa.Column("clean_sheet_probability", sa.Float(), nullable=False),
        sa.Column("bonus_probability", sa.Float(), nullable=False),
        sa.Column("defensive_contribution_probability", sa.Float(), nullable=False),
        sa.Column("expected_bonus", sa.Float(), nullable=False),
        sa.Column("expected_defensive_contribution_points", sa.Float(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("event_priors", sa.JSON(), nullable=False),
        sa.Column("lineage", sa.JSON(), nullable=False),
        sa.Column("reasons", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["snapshot_id"], ["raw_snapshots.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "simulation_id",
            "player_source_id",
            "fixture_source_id",
            name="uq_player_points_forecast",
        ),
    )
    op.create_index(
        "ix_player_points_snapshot_generated",
        "player_points_forecasts",
        ["snapshot_id", "generated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_player_points_snapshot_generated", table_name="player_points_forecasts")
    op.drop_table("player_points_forecasts")
    for name in reversed(
        (
            "expected_goals_per_90",
            "expected_assists_per_90",
            "clean_sheets_per_90",
            "saves_per_90",
            "yellow_cards_per_90",
            "bps_per_90",
            "bonus_per_90",
            "defensive_contribution_per_90",
        )
    ):
        op.drop_column("player_snapshots", name)
