from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.database import Base, create_database_engine, get_session
from app.ingestion import QualityThresholds, ingest_current_snapshot
from app.historical import import_historical_csv_text, import_team_match_csv_text
from app.main import app
from app.providers import FixtureFplProvider


def test_snapshot_read_api(
    fpl_payload,
    historical_minutes_csv,
    historical_team_matches_csv,
):
    engine = create_database_engine("sqlite://")
    Base.metadata.create_all(engine)
    test_sessions = sessionmaker(bind=engine, expire_on_commit=False)

    with test_sessions() as session:
        ingest_current_snapshot(
            session,
            FixtureFplProvider(
                bootstrap=fpl_payload[0],
                fixtures=fpl_payload[1],
                retrieved_at=datetime(2026, 7, 29, tzinfo=timezone.utc),
            ),
            "2026/27",
            QualityThresholds(4, 2, 2),
        )
        historical = import_historical_csv_text(
            session,
            historical_minutes_csv,
            source="deterministic-test",
            source_uri="fixture://historical-minutes",
            season_id="2025-26",
            license_status="development-only",
        )
        team_history = import_team_match_csv_text(
            session,
            historical_team_matches_csv,
            source="deterministic-team-test",
            source_uri="fixture://team-matches",
            season_id="2024-25",
            license_status="development-only",
        )

    def override_session():
        with test_sessions() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    try:
        with TestClient(app) as client:
            assert client.get("/health").json()["status"] == "ok"
            assert client.get("/v1/snapshots/latest").json()["player_count"] == 4

            forwards = client.get("/v1/snapshots/latest/players?position=FWD")
            assert forwards.status_code == 200
            assert [player["source_id"] for player in forwards.json()] == [202]

            exported = client.get("/v1/snapshots/latest/export").json()
            assert len(exported["bootstrap"]["elements"]) == 4
            assert len(exported["fixtures"]) == 2

            trained = client.post(
                "/v1/models/expected-minutes/train",
                json={"dataset_ids": [historical.dataset_id], "minimum_history": 3},
            )
            assert trained.status_code == 200
            assert trained.json()["status"] == "experimental"

            created = client.post("/v1/predictions/expected-minutes/latest")
            assert created.status_code == 200
            assert len(created.json()) == 4
            for forecast in created.json():
                assert (
                    forecast["start_probability"]
                    + forecast["substitute_probability"]
                    + forecast["zero_minutes_probability"]
                ) == pytest.approx(1)

            latest_predictions = client.get("/v1/predictions/expected-minutes/latest")
            assert latest_predictions.status_code == 200
            assert len(latest_predictions.json()) == 4

            coverage = client.get("/v1/identities/latest/coverage")
            assert coverage.status_code == 200
            assert coverage.json()["resolved"] == 4

            backtest = client.post(
                "/v1/backtests/expected-minutes",
                json={"dataset_ids": [historical.dataset_id]},
            )
            assert backtest.status_code == 200
            assert backtest.json()["sample_count"] > 0

            latest_backtest = client.get("/v1/backtests/expected-minutes/latest")
            assert latest_backtest.status_code == 200
            assert latest_backtest.json()["id"] == backtest.json()["id"]

            event_model = client.post(
                "/v1/models/player-events/train",
                json={"dataset_ids": [historical.dataset_id], "minimum_history": 6},
            )
            assert event_model.status_code == 200
            assert (
                event_model.json()["model_version"]
                == "shrunk-player-position-poisson-v1"
            )

            event_backtest = client.post(
                "/v1/backtests/player-events",
                json={
                    "dataset_ids": [historical.dataset_id],
                    "initial_training_gameweeks": 6,
                },
            )
            assert event_backtest.status_code == 200
            assert event_backtest.json()["sample_count"] > 0

            team_model = client.post(
                "/v1/models/team-strength/train",
                json={"dataset_ids": [team_history.dataset_id]},
            )
            assert team_model.status_code == 200
            assert team_model.json()["model_version"] == "time-decayed-poisson-v1"

            match_forecasts = client.post("/v1/predictions/matches/latest")
            assert match_forecasts.status_code == 200
            assert len(match_forecasts.json()) == 2
            for match in match_forecasts.json():
                assert (
                    match["home_win_probability"]
                    + match["draw_probability"]
                    + match["away_win_probability"]
                ) == pytest.approx(1)

            point_forecasts = client.post(
                "/v1/predictions/player-points/latest?simulations=400&seed=77&horizon=1"
            )
            assert point_forecasts.status_code == 200
            assert len(point_forecasts.json()) == 4
            for forecast in point_forecasts.json():
                assert forecast["rules_version"] == "fpl-2026-27-v1"
                assert forecast["model_version"] == "correlated-player-points-monte-carlo-v1"
                assert forecast["p10_points"] <= forecast["median_points"]
                assert forecast["median_points"] <= forecast["p90_points"]
                assert (
                    forecast["fifteen_plus_probability"]
                    <= forecast["ten_plus_probability"]
                    <= forecast["five_plus_probability"]
                    <= forecast["two_plus_probability"]
                )
                assert 0 <= forecast["bonus_probability"] <= 1
                assert 0 <= forecast["defensive_contribution_probability"] <= 1
                assert (
                    forecast["lineage"]["eventModelVersion"]
                    == "shrunk-player-position-poisson-v1"
                )
                assert (
                    forecast["event_priors"]["source"]
                    == "trained-player-or-position-prior"
                )

            repeated_point_forecasts = client.post(
                "/v1/predictions/player-points/latest?simulations=400&seed=77&horizon=1"
            )
            assert repeated_point_forecasts.status_code == 200
            first_values = sorted(
                (
                    row["player_source_id"],
                    row["fixture_source_id"],
                    row["expected_points"],
                    row["bonus_probability"],
                    row["defensive_contribution_probability"],
                )
                for row in point_forecasts.json()
            )
            repeated_values = sorted(
                (
                    row["player_source_id"],
                    row["fixture_source_id"],
                    row["expected_points"],
                    row["bonus_probability"],
                    row["defensive_contribution_probability"],
                )
                for row in repeated_point_forecasts.json()
            )
            assert repeated_values == first_values

            latest_point_forecasts = client.get(
                "/v1/predictions/player-points/latest"
            )
            assert latest_point_forecasts.status_code == 200
            assert len(latest_point_forecasts.json()) == 4

            team_backtest = client.post(
                "/v1/backtests/team-strength",
                json={"dataset_ids": [team_history.dataset_id]},
            )
            assert team_backtest.status_code == 200
            assert team_backtest.json()["sample_count"] > 0
    finally:
        app.dependency_overrides.clear()
