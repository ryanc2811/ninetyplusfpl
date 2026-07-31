"""Create immutable FPL snapshots and normalized entities.

Revision ID: 0001
Revises:
Create Date: 2026-07-29
"""

from collections.abc import Sequence
from typing import Optional, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: Optional[str] = None
branch_labels: Optional[Union[str, Sequence[str]]] = None
depends_on: Optional[Union[str, Sequence[str]]] = None


def upgrade() -> None:
    op.create_table(
        "seasons",
        sa.Column("id", sa.String(length=16), primary_key=True),
        sa.Column("name", sa.String(length=16), nullable=False),
        sa.Column("start_year", sa.Integer(), nullable=False),
        sa.Column("rules_version", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("name", name="uq_seasons_name"),
    )
    op.create_table(
        "gameweeks",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("season_id", sa.String(length=16), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("deadline_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_finished", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["season_id"], ["seasons.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("season_id", "number", name="uq_gameweek_season_number"),
    )
    op.create_table(
        "raw_snapshots",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("retrieved_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("season_id", sa.String(length=16), nullable=False),
        sa.Column("gameweek", sa.Integer(), nullable=False),
        sa.Column("request_parameters", sa.JSON(), nullable=False),
        sa.Column("source_event_timestamp", sa.DateTime(timezone=True), nullable=True),
        sa.Column("checksum", sa.String(length=64), nullable=False),
        sa.Column("schema_version", sa.String(length=32), nullable=False),
        sa.Column("ingestion_status", sa.String(length=24), nullable=False),
        sa.Column("raw_payload", sa.JSON(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["season_id"], ["seasons.id"]),
        sa.UniqueConstraint("source", "checksum", name="uq_snapshot_source_checksum"),
    )
    op.create_index(
        "ix_snapshot_season_gameweek_retrieved",
        "raw_snapshots",
        ["season_id", "gameweek", "retrieved_at"],
    )
    op.create_table(
        "team_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("snapshot_id", sa.String(length=36), nullable=False),
        sa.Column("source_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=96), nullable=False),
        sa.Column("short_name", sa.String(length=8), nullable=False),
        sa.Column("strength", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["snapshot_id"], ["raw_snapshots.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("snapshot_id", "source_id", name="uq_team_snapshot_source"),
    )
    op.create_table(
        "player_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("snapshot_id", sa.String(length=36), nullable=False),
        sa.Column("source_id", sa.Integer(), nullable=False),
        sa.Column("team_source_id", sa.Integer(), nullable=False),
        sa.Column("web_name", sa.String(length=96), nullable=False),
        sa.Column("first_name", sa.String(length=96), nullable=False),
        sa.Column("second_name", sa.String(length=96), nullable=False),
        sa.Column("position", sa.String(length=8), nullable=False),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("status", sa.String(length=8), nullable=False),
        sa.Column("chance_next_round", sa.Integer(), nullable=True),
        sa.Column("minutes", sa.Integer(), nullable=False),
        sa.Column("starts", sa.Integer(), nullable=False),
        sa.Column("total_points", sa.Integer(), nullable=False),
        sa.Column("form", sa.Float(), nullable=False),
        sa.Column("selected_by_percent", sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(["snapshot_id"], ["raw_snapshots.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("snapshot_id", "source_id", name="uq_player_snapshot_source"),
    )
    op.create_index(
        "ix_player_snapshot_position_price",
        "player_snapshots",
        ["snapshot_id", "position", "price"],
    )
    op.create_table(
        "fixture_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("snapshot_id", sa.String(length=36), nullable=False),
        sa.Column("source_id", sa.Integer(), nullable=False),
        sa.Column("event", sa.Integer(), nullable=True),
        sa.Column("home_team_source_id", sa.Integer(), nullable=False),
        sa.Column("away_team_source_id", sa.Integer(), nullable=False),
        sa.Column("home_difficulty", sa.Integer(), nullable=False),
        sa.Column("away_difficulty", sa.Integer(), nullable=False),
        sa.Column("kickoff_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started", sa.Boolean(), nullable=False),
        sa.Column("finished", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["snapshot_id"], ["raw_snapshots.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("snapshot_id", "source_id", name="uq_fixture_snapshot_source"),
    )
    op.create_index(
        "ix_fixture_snapshot_event",
        "fixture_snapshots",
        ["snapshot_id", "event"],
    )


def downgrade() -> None:
    op.drop_index("ix_fixture_snapshot_event", table_name="fixture_snapshots")
    op.drop_table("fixture_snapshots")
    op.drop_index("ix_player_snapshot_position_price", table_name="player_snapshots")
    op.drop_table("player_snapshots")
    op.drop_table("team_snapshots")
    op.drop_index("ix_snapshot_season_gameweek_retrieved", table_name="raw_snapshots")
    op.drop_table("raw_snapshots")
    op.drop_table("gameweeks")
    op.drop_table("seasons")
