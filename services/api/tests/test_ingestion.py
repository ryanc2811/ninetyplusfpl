from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import Base, create_database_engine
from app.ingestion import QualityThresholds, ingest_current_snapshot
from app.models import FixtureSnapshot, PlayerSnapshot, RawSnapshot, TeamSnapshot
from app.providers import FixtureFplProvider


THRESHOLDS = QualityThresholds(minimum_players=4, expected_teams=2, minimum_fixtures=2)


def test_ingestion_is_normalized_and_idempotent(fpl_payload):
    engine = create_database_engine("sqlite://")
    Base.metadata.create_all(engine)
    provider = FixtureFplProvider(
        bootstrap=fpl_payload[0],
        fixtures=fpl_payload[1],
        retrieved_at=datetime(2026, 7, 29, tzinfo=timezone.utc),
    )

    with Session(engine) as session:
        first = ingest_current_snapshot(session, provider, "2026/27", THRESHOLDS)
        second = ingest_current_snapshot(session, provider, "2026/27", THRESHOLDS)

        assert first.created is True
        assert second.created is False
        assert first.checksum == second.checksum
        assert session.scalar(select(func.count()).select_from(RawSnapshot)) == 1
        assert session.scalar(select(func.count()).select_from(TeamSnapshot)) == 2
        assert session.scalar(select(func.count()).select_from(PlayerSnapshot)) == 4
        assert session.scalar(select(func.count()).select_from(FixtureSnapshot)) == 2


def test_quality_gate_rejects_unknown_player_team(fpl_payload):
    bootstrap, fixtures = fpl_payload
    bootstrap["elements"][0]["team"] = 999
    engine = create_database_engine("sqlite://")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        with pytest.raises(ValueError, match="unknown teams"):
            ingest_current_snapshot(
                session,
                FixtureFplProvider(bootstrap=bootstrap, fixtures=fixtures),
                "2026/27",
                THRESHOLDS,
            )


def test_ingestion_normalizes_player_event_rates(fpl_payload):
    bootstrap, fixtures = fpl_payload
    bootstrap["elements"][0].update(
        {
            "expected_goals_per_90": "0.05",
            "expected_assists_per_90": "0.07",
            "defensive_contribution_per_90": "8.4",
            "minutes": 900,
            "saves": 36,
            "yellow_cards": 2,
            "bps": 180,
            "bonus": 12,
        }
    )
    engine = create_database_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        ingest_current_snapshot(
            session,
            FixtureFplProvider(bootstrap=bootstrap, fixtures=fixtures),
            "2026/27",
            THRESHOLDS,
        )
        player = session.scalar(
            select(PlayerSnapshot).where(PlayerSnapshot.source_id == 101)
        )
        assert player is not None
        assert player.expected_goals_per_90 == pytest.approx(0.05)
        assert player.defensive_contribution_per_90 == pytest.approx(8.4)
        assert player.saves_per_90 == pytest.approx(3.6)
        assert player.bps_per_90 == pytest.approx(18)
