"""Retain historical player-event outcomes for calibration.

Revision ID: 0006
Revises: 0005
"""

from alembic import op
import sqlalchemy as sa


revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


EVENT_COLUMNS = (
    "goals_scored",
    "assists",
    "clean_sheets",
    "saves",
    "yellow_cards",
    "bonus",
    "bps",
    "defensive_contributions",
)


def upgrade() -> None:
    for name in EVENT_COLUMNS:
        op.add_column(
            "player_gameweek_observations",
            sa.Column(name, sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    for name in reversed(EVENT_COLUMNS):
        op.drop_column("player_gameweek_observations", name)
