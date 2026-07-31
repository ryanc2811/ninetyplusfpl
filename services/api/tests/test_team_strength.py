import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import Base, create_database_engine
from app.historical import import_team_match_csv_text
from app.models import HistoricalDataset, TeamMatchObservation
from app.team_strength import (
    backtest_team_strength,
    predict_match,
    train_team_strength,
)


def test_team_match_import_and_poisson_training(historical_team_matches_csv):
    engine = create_database_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        imported = import_team_match_csv_text(
            session,
            historical_team_matches_csv,
            source="deterministic-team-test",
            source_uri="fixture://team-matches",
            season_id="2024-25",
            license_status="development-only",
        )
        duplicate = import_team_match_csv_text(
            session,
            historical_team_matches_csv,
            source="deterministic-team-test",
            source_uri="fixture://team-matches",
            season_id="2024-25",
            license_status="development-only",
        )
        assert imported.created is True
        assert duplicate.created is False
        assert session.scalar(select(func.count()).select_from(HistoricalDataset)) == 1
        assert session.scalar(select(func.count()).select_from(TeamMatchObservation)) == 24

        model_run = train_team_strength(session, [imported.dataset_id])
        assert model_run.model_version == "time-decayed-poisson-v1"
        assert model_run.metrics["goals_mae"] >= 0
        assert model_run.metrics["evaluation"] == "locked temporal holdout"
        assert set(model_run.artifact["teams"]) == {"NTH", "STH", "EAS", "WST"}

        prediction = predict_match(model_run.artifact, "NTH", "STH")
        assert prediction.expected_home_goals > prediction.expected_away_goals
        assert (
            prediction.home_win_probability
            + prediction.draw_probability
            + prediction.away_win_probability
        ) == pytest.approx(1)
        assert 0 <= prediction.home_clean_sheet_probability <= 1
        assert len(prediction.scoreline_probabilities) == 8

        report = backtest_team_strength(session, [imported.dataset_id])
        assert report.sample_count > 0
        assert report.verdict in {"beats-baseline", "does-not-beat-baseline"}
