from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import Base, create_database_engine
from app.expected_minutes import (
    FEATURE_NAMES,
    apply_team_lineup_constraints,
    apply_team_opportunity_adjustments,
    backtest_expected_minutes,
    build_training_examples,
    predict_expected_minutes,
    train_expected_minutes,
)
from app.identity import normalize_player_name
from app.historical import HistoricalDataError, import_historical_csv_text
from app.models import HistoricalDataset, PlayerGameweekObservation, PlayerIdentity


def test_historical_import_is_validated_and_idempotent(historical_minutes_csv):
    engine = create_database_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        first = import_historical_csv_text(
            session,
            historical_minutes_csv,
            source="deterministic-test",
            source_uri="fixture://historical-minutes",
            season_id="2025-26",
            license_status="development-only",
            retrieved_at=datetime(2026, 7, 29, tzinfo=timezone.utc),
        )
        first_dataset = session.get(HistoricalDataset, first.dataset_id)
        legacy_row = session.scalar(
            select(PlayerGameweekObservation).where(
                PlayerGameweekObservation.player_name == "Alex Keeper",
                PlayerGameweekObservation.gameweek == 1,
            )
        )
        assert first_dataset is not None
        assert legacy_row is not None
        first_dataset.schema_version = "player-gameweek-csv-v1"
        legacy_row.saves = 0
        session.commit()
        second = import_historical_csv_text(
            session,
            historical_minutes_csv,
            source="deterministic-test",
            source_uri="fixture://historical-minutes",
            season_id="2025-26",
            license_status="development-only",
        )

        assert first.created is True
        assert second.created is False
        assert first.row_count == 48
        assert session.scalar(select(func.count()).select_from(HistoricalDataset)) == 1
        assert session.scalar(select(func.count()).select_from(PlayerGameweekObservation)) == 48
        assert first_dataset.schema_version == "player-gameweek-csv-v2"
        event_row = session.scalar(
            select(PlayerGameweekObservation).where(
                PlayerGameweekObservation.player_name == "Alex Keeper",
                PlayerGameweekObservation.gameweek == 1,
            )
        )
        assert event_row is not None
        assert event_row.saves == 3
        assert event_row.bps > 0

    with Session(engine) as session:
        with pytest.raises(HistoricalDataError, match="license_status"):
            import_historical_csv_text(
                session,
                historical_minutes_csv,
                source="unsafe",
                source_uri="fixture://unsafe",
                season_id="2025-26",
                license_status="unknown",
            )


def test_temporal_model_is_calibrated_serializable_and_bounded(historical_minutes_csv):
    engine = create_database_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        imported = import_historical_csv_text(
            session,
            historical_minutes_csv,
            source="deterministic-test",
            source_uri="fixture://historical-minutes",
            season_id="2025-26",
            license_status="development-only",
        )
        observations = list(session.scalars(select(PlayerGameweekObservation)))
        examples = build_training_examples(observations)
        assert all("xP" not in name for name in FEATURE_NAMES)
        assert examples[0].time_key == ("2025-26", 4)

        run = train_expected_minutes(session, [imported.dataset_id])
        assert run.training_cutoff < run.validation_cutoff
        assert run.metrics["evaluation"] == "locked temporal holdout"
        assert run.metrics["minutes_mae"] >= 0
        assert len(run.artifact["calibrators"]) == 3

        forecast = predict_expected_minutes(run.artifact, examples[-1].values)
        total_probability = (
            forecast.start_probability
            + forecast.substitute_probability
            + forecast.zero_minutes_probability
        )
        assert total_probability == pytest.approx(1)
        assert 0 <= forecast.expected_minutes <= 90
        assert 0 <= forecast.sixty_minute_probability <= 1


def test_cross_season_identity_and_expanding_backtest(
    historical_minutes_csv,
    prior_season_minutes_csv,
):
    engine = create_database_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        previous = import_historical_csv_text(
            session,
            prior_season_minutes_csv,
            source="deterministic-test",
            source_uri="fixture://2024-25-minutes",
            season_id="2024-25",
            license_status="development-only",
        )
        current = import_historical_csv_text(
            session,
            historical_minutes_csv,
            source="deterministic-test",
            source_uri="fixture://2025-26-minutes",
            season_id="2025-26",
            license_status="development-only",
        )

        assert normalize_player_name("Joško Gvardiol") == "josko gvardiol"
        assert session.scalar(select(func.count()).select_from(PlayerIdentity)) == 4
        keeper_identity_ids = set(
            session.scalars(
                select(PlayerGameweekObservation.player_identity_id).where(
                    PlayerGameweekObservation.player_name == "Alex Keeper"
                )
            )
        )
        assert len(keeper_identity_ids) == 1

        report = backtest_expected_minutes(
            session,
            [previous.dataset_id, current.dataset_id],
        )
        assert report.sample_count > 0
        assert len(report.fold_metrics) >= 3
        assert report.configuration["split"] == "expanding-window by season and Gameweek"
        assert report.verdict in {"beats-baseline", "does-not-beat-baseline"}
        assert report.aggregate_metrics["minutes_mae"] >= 0
        assert report.baseline_metrics["minutes_mae"] >= 0


def test_double_gameweek_results_do_not_leak_between_same_deadline_rows(
    historical_minutes_csv,
):
    engine = create_database_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        imported = import_historical_csv_text(
            session,
            historical_minutes_csv,
            source="deterministic-test",
            source_uri="fixture://historical-minutes",
            season_id="2025-26",
            license_status="development-only",
        )
        original = session.scalar(
            select(PlayerGameweekObservation).where(
                PlayerGameweekObservation.dataset_id == imported.dataset_id,
                PlayerGameweekObservation.player_name == "Alex Keeper",
                PlayerGameweekObservation.gameweek == 4,
            )
        )
        assert original is not None
        session.add(
            PlayerGameweekObservation(
                dataset_id=original.dataset_id,
                player_identity_id=original.player_identity_id,
                season_id=original.season_id,
                gameweek=original.gameweek,
                player_source_id=original.player_source_id,
                player_name=original.player_name,
                position=original.position,
                team_name=original.team_name,
                opponent_name="East Athletic",
                fixture_source_id=999,
                kickoff_time=original.kickoff_time + timedelta(days=2),
                was_home=False,
                difficulty=4,
                minutes=0,
                started=False,
                start_inferred=False,
                total_points=0,
                row_checksum="double-gameweek-test",
            )
        )
        session.flush()
        examples = build_training_examples(
            list(session.scalars(select(PlayerGameweekObservation)))
        )
        double_rows = [
            example
            for example in examples
            if example.player_identity_id == original.player_identity_id
            and example.time_key == ("2025-26", 4)
        ]
        assert len(double_rows) == 2
        assert double_rows[0].values[:6] == double_rows[1].values[:6]


def test_team_opportunity_moves_injured_starter_probability_to_replacement():
    def player(source_id, name, *, status="a", chance=None, starts=0):
        return SimpleNamespace(
            source_id=source_id,
            team_source_id=1,
            web_name=name,
            position="DEF",
            price=6.0 if name == "Saliba" else 5.5,
            status=status,
            chance_next_round=chance,
            starts=starts,
        )

    def forecast(source_id):
        return SimpleNamespace(
            player_source_id=source_id,
            start_probability=0.30,
            substitute_probability=0.20,
            zero_minutes_probability=0.50,
            expected_minutes_if_start=78.0,
            expected_minutes_if_substitute=18.0,
            expected_minutes=27.0,
            sixty_minute_probability=0.25,
            early_substitution_probability=0.05,
            confidence=0.45,
            features={},
            reasons=[],
        )

    players = [
        player(1, "Saliba", status="i", chance=0, starts=34),
        player(2, "Mosquera"),
        player(3, "Calafiori"),
        player(4, "White"),
    ]
    forecasts = [forecast(index) for index in range(1, 5)]
    adjusted = apply_team_opportunity_adjustments(players, forecasts, 38)
    mosquera = next(item for item in adjusted if item.player_source_id == 2)
    calafiori = next(item for item in adjusted if item.player_source_id == 3)

    assert mosquera.start_probability > 0.70
    assert mosquera.start_probability > calafiori.start_probability
    assert (
        mosquera.start_probability
        + mosquera.substitute_probability
        + mosquera.zero_minutes_probability
    ) == pytest.approx(1)
    assert mosquera.features["unavailable_teammate"] == "Saliba"
    assert any("Saliba" in reason for reason in mosquera.reasons)


def test_complete_club_roster_is_constrained_to_one_probabilistic_xi():
    players = []
    forecasts = []
    source_id = 0
    for position, count in (("GK", 2), ("DEF", 7), ("MID", 8), ("FWD", 4)):
        for index in range(count):
            source_id += 1
            injured = source_id == 3
            players.append(
                SimpleNamespace(
                    source_id=source_id,
                    team_source_id=1,
                    web_name=f"Player {source_id}",
                    position=position,
                    price=4.5 + (count - index) * 0.5,
                    status="i" if injured else "a",
                    chance_next_round=0 if injured else None,
                    starts=max(0, 34 - index * 6),
                    selected_by_percent=max(0, 30 - index * 4),
                )
            )
            forecasts.append(
                SimpleNamespace(
                    player_source_id=source_id,
                    start_probability=max(0.05, 0.86 - index * 0.11),
                    substitute_probability=0.10,
                    zero_minutes_probability=max(0.04, 0.04 + index * 0.11),
                    expected_minutes_if_start=78.0,
                    expected_minutes_if_substitute=18.0,
                    expected_minutes=60.0,
                    sixty_minute_probability=max(0.04, 0.72 - index * 0.1),
                    early_substitution_probability=0.08,
                    confidence=0.45,
                    features={},
                    reasons=[],
                )
            )

    adjusted = apply_team_lineup_constraints(players, forecasts, 38)

    assert sum(item.start_probability for item in adjusted) == pytest.approx(
        11,
        abs=0.06,
    )
    assert adjusted[2].start_probability == 0
    assert all(item.features["team_lineup_applied"] for item in adjusted)
    assert any(
        "team lineup constraint:" in reason
        for item in adjusted
        for reason in item.reasons
    )
