from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import Base, create_database_engine
from app.historical import import_historical_csv_text
from app.models import PlayerGameweekObservation
from app.player_events import backtest_player_events, train_player_events


def test_player_event_model_trains_and_backtests_without_future_leakage(
    historical_minutes_csv,
):
    engine = create_database_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        imported = import_historical_csv_text(
            session,
            historical_minutes_csv,
            source="deterministic-events",
            source_uri="fixture://historical-events",
            season_id="2025-26",
            license_status="development-only",
        )
        model = train_player_events(
            session,
            [imported.dataset_id],
            minimum_history=6,
        )
        assert model.model_version == "shrunk-player-position-poisson-v1"
        assert model.training_cutoff < model.validation_cutoff
        assert len(model.artifact["playerRates"]) == 4
        assert set(model.artifact["positionRates"]) == {"GK", "DEF", "MID", "FWD"}
        assert model.metrics["event_brier_score"] >= 0
        assert model.metrics["evaluation"] == "locked temporal holdout"

        report = backtest_player_events(
            session,
            [imported.dataset_id],
            initial_training_gameweeks=6,
        )
        first_fold = report.fold_metrics[0]
        assert report.sample_count > 0
        assert len(report.fold_metrics) == 6
        assert report.aggregate_metrics["event_brier_score"] >= 0
        assert report.baseline_metrics["event_brier_score"] >= 0

        future = session.scalar(
            select(PlayerGameweekObservation).where(
                PlayerGameweekObservation.gameweek == 12,
                PlayerGameweekObservation.player_name == "Jo Forward",
            )
        )
        assert future is not None
        future.goals_scored = 20
        future.assists = 20
        session.commit()
        repeated = backtest_player_events(
            session,
            [imported.dataset_id],
            initial_training_gameweeks=6,
        )
        assert repeated.fold_metrics[0] == first_fold
