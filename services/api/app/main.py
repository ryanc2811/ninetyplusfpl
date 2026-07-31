from __future__ import annotations

from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from .config import get_settings
from .database import get_session
from .expected_minutes import (
    MODEL_TYPE,
    ModelTrainingError,
    backtest_expected_minutes,
    generate_latest_forecasts,
    train_expected_minutes,
)
from .identity import resolve_snapshot_identities, snapshot_identity_coverage
from .ingestion import ingest_current_snapshot, snapshot_summary
from .models import (
    BacktestReport,
    ExpectedMinutesForecast,
    MatchForecast,
    ModelRun,
    PlayerPointsForecast,
    PlayerSnapshot,
    RawSnapshot,
)
from .providers import OfficialFplProvider
from .schemas import (
    ExpectedMinutesForecastRead,
    BacktestReportRead,
    BacktestRequest,
    IdentityCoverageRead,
    ModelRunRead,
    ModelTrainRequest,
    PlayerRead,
    SnapshotExport,
    SnapshotSummary,
    MatchForecastRead,
    PlayerPointsForecastRead,
    TeamBacktestRequest,
)
from .points_simulation import PointsSimulationError, generate_player_points_forecasts
from .player_events import (
    MODEL_TYPE as PLAYER_EVENT_MODEL_TYPE,
    PlayerEventModelError,
    backtest_player_events,
    latest_player_event_model,
    train_player_events,
)
from .team_strength import (
    MODEL_TYPE as TEAM_MODEL_TYPE,
    TeamModelError,
    backtest_team_strength,
    generate_match_forecasts,
    train_team_strength,
)


app = FastAPI(
    title="NINETY+ Data API",
    version="0.1.0",
    description="Immutable FPL source snapshots and normalized relational reads.",
)


def latest_snapshot(session: Session) -> RawSnapshot:
    snapshot = session.scalar(
        select(RawSnapshot)
        .where(RawSnapshot.ingestion_status == "succeeded")
        .order_by(desc(RawSnapshot.retrieved_at))
        .limit(1)
    )
    if not snapshot:
        raise HTTPException(status_code=404, detail="No successful snapshot has been ingested")
    return snapshot


@app.get("/health")
def health():
    return {"status": "ok", "service": "ninety-plus-data-api"}


@app.post("/v1/ingestions/fpl/current", response_model=SnapshotSummary)
def ingest_fpl_current(session: Session = Depends(get_session)):
    settings = get_settings()
    try:
        return ingest_current_snapshot(
            session,
            OfficialFplProvider(settings.provider_timeout_seconds),
            settings.season,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/v1/snapshots/latest", response_model=SnapshotSummary)
def get_latest_snapshot(session: Session = Depends(get_session)):
    snapshot = latest_snapshot(session)
    return snapshot_summary(session, snapshot, created=False)


@app.get("/v1/snapshots/latest/players", response_model=list[PlayerRead])
def get_latest_players(
    position: Optional[str] = Query(default=None, pattern="^(GK|DEF|MID|FWD)$"),
    session: Session = Depends(get_session),
):
    snapshot = latest_snapshot(session)
    query = select(PlayerSnapshot).where(PlayerSnapshot.snapshot_id == snapshot.id)
    if position:
        query = query.where(PlayerSnapshot.position == position)
    return list(session.scalars(query.order_by(PlayerSnapshot.web_name)))


@app.get("/v1/snapshots/latest/export", response_model=SnapshotExport)
def export_latest_snapshot(session: Session = Depends(get_session)):
    snapshot = latest_snapshot(session)
    payload = snapshot.raw_payload
    return SnapshotExport(
        snapshot_id=snapshot.id,
        provenance={
            "source": snapshot.source,
            "retrievedAt": snapshot.retrieved_at.isoformat(),
            "checksum": snapshot.checksum,
            "schemaVersion": snapshot.schema_version,
            "season": snapshot.season_id.replace("-", "/"),
            "gameweek": snapshot.gameweek,
            "requestUrls": snapshot.request_parameters.get("urls", []),
        },
        bootstrap=payload["bootstrap"],
        fixtures=payload["fixtures"],
    )


@app.post("/v1/models/expected-minutes/train", response_model=ModelRunRead)
def train_expected_minutes_model(
    request: ModelTrainRequest,
    session: Session = Depends(get_session),
):
    try:
        return train_expected_minutes(
            session,
            request.dataset_ids,
            minimum_history=request.minimum_history,
        )
    except ModelTrainingError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/v1/models/expected-minutes/latest", response_model=ModelRunRead)
def get_latest_expected_minutes_model(session: Session = Depends(get_session)):
    model_run = session.scalar(
        select(ModelRun)
        .where(ModelRun.model_type == MODEL_TYPE)
        .order_by(desc(ModelRun.created_at))
        .limit(1)
    )
    if not model_run:
        raise HTTPException(status_code=404, detail="No expected-minutes model has been trained")
    return model_run


@app.post(
    "/v1/predictions/expected-minutes/latest",
    response_model=list[ExpectedMinutesForecastRead],
)
def create_latest_expected_minutes_forecasts(
    model_run_id: Optional[str] = None,
    session: Session = Depends(get_session),
):
    try:
        return generate_latest_forecasts(session, model_run_id)
    except ModelTrainingError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get(
    "/v1/predictions/expected-minutes/latest",
    response_model=list[ExpectedMinutesForecastRead],
)
def get_latest_expected_minutes_forecasts(session: Session = Depends(get_session)):
    snapshot = latest_snapshot(session)
    latest_generated_at = session.scalar(
        select(ExpectedMinutesForecast.generated_at)
        .where(ExpectedMinutesForecast.snapshot_id == snapshot.id)
        .order_by(desc(ExpectedMinutesForecast.generated_at))
        .limit(1)
    )
    if not latest_generated_at:
        raise HTTPException(status_code=404, detail="No expected-minutes forecasts are available")
    return list(
        session.scalars(
            select(ExpectedMinutesForecast)
            .where(
                ExpectedMinutesForecast.snapshot_id == snapshot.id,
                ExpectedMinutesForecast.generated_at == latest_generated_at,
            )
            .order_by(desc(ExpectedMinutesForecast.expected_minutes))
        )
    )


@app.post("/v1/identities/latest/resolve", response_model=IdentityCoverageRead)
def resolve_latest_player_identities(session: Session = Depends(get_session)):
    snapshot = latest_snapshot(session)
    return resolve_snapshot_identities(session, snapshot.id, snapshot.season_id)


@app.get("/v1/identities/latest/coverage", response_model=IdentityCoverageRead)
def get_latest_identity_coverage(session: Session = Depends(get_session)):
    snapshot = latest_snapshot(session)
    return snapshot_identity_coverage(session, snapshot.id)


@app.post("/v1/backtests/expected-minutes", response_model=BacktestReportRead)
def create_expected_minutes_backtest(
    request: BacktestRequest,
    session: Session = Depends(get_session),
):
    try:
        return backtest_expected_minutes(
            session,
            request.dataset_ids,
            minimum_history=request.minimum_history,
            initial_training_gameweeks=request.initial_training_gameweeks,
            calibration_gameweeks=request.calibration_gameweeks,
        )
    except ModelTrainingError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/v1/backtests/expected-minutes/latest", response_model=BacktestReportRead)
def get_latest_expected_minutes_backtest(session: Session = Depends(get_session)):
    report = session.scalar(
        select(BacktestReport)
        .where(BacktestReport.model_type == MODEL_TYPE)
        .order_by(desc(BacktestReport.created_at))
        .limit(1)
    )
    if not report:
        raise HTTPException(status_code=404, detail="No expected-minutes backtest is available")
    return report


@app.post("/v1/models/team-strength/train", response_model=ModelRunRead)
def train_team_strength_model(
    request: ModelTrainRequest,
    session: Session = Depends(get_session),
):
    try:
        return train_team_strength(session, request.dataset_ids)
    except TeamModelError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/v1/models/team-strength/latest", response_model=ModelRunRead)
def get_latest_team_strength_model(session: Session = Depends(get_session)):
    model_run = session.scalar(
        select(ModelRun)
        .where(ModelRun.model_type == TEAM_MODEL_TYPE)
        .order_by(desc(ModelRun.created_at))
        .limit(1)
    )
    if not model_run:
        raise HTTPException(status_code=404, detail="No team-strength model has been trained")
    return model_run


@app.post("/v1/predictions/matches/latest", response_model=list[MatchForecastRead])
def create_latest_match_forecasts(
    model_run_id: Optional[str] = None,
    session: Session = Depends(get_session),
):
    try:
        return generate_match_forecasts(session, model_run_id)
    except TeamModelError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/v1/predictions/matches/latest", response_model=list[MatchForecastRead])
def get_latest_match_forecasts(session: Session = Depends(get_session)):
    snapshot = latest_snapshot(session)
    latest_generated_at = session.scalar(
        select(MatchForecast.generated_at)
        .where(MatchForecast.snapshot_id == snapshot.id)
        .order_by(desc(MatchForecast.generated_at))
        .limit(1)
    )
    if not latest_generated_at:
        raise HTTPException(status_code=404, detail="No match forecasts are available")
    return list(
        session.scalars(
            select(MatchForecast)
            .where(
                MatchForecast.snapshot_id == snapshot.id,
                MatchForecast.generated_at == latest_generated_at,
            )
            .order_by(MatchForecast.fixture_source_id)
        )
    )


@app.post(
    "/v1/predictions/player-points/latest",
    response_model=list[PlayerPointsForecastRead],
)
def create_latest_player_points_forecasts(
    simulations: int = Query(default=2000, ge=100, le=25000),
    seed: int = Query(default=2627, ge=0, le=2_147_483_647),
    horizon: int = Query(default=3, ge=1, le=3),
    session: Session = Depends(get_session),
):
    try:
        return generate_player_points_forecasts(
            session,
            simulations=simulations,
            seed=seed,
            horizon=horizon,
        )
    except PointsSimulationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get(
    "/v1/predictions/player-points/latest",
    response_model=list[PlayerPointsForecastRead],
)
def get_latest_player_points_forecasts(session: Session = Depends(get_session)):
    snapshot = latest_snapshot(session)
    latest_generated_at = session.scalar(
        select(PlayerPointsForecast.generated_at)
        .where(PlayerPointsForecast.snapshot_id == snapshot.id)
        .order_by(desc(PlayerPointsForecast.generated_at))
        .limit(1)
    )
    if not latest_generated_at:
        raise HTTPException(status_code=404, detail="No player-points forecasts are available")
    return list(
        session.scalars(
            select(PlayerPointsForecast)
            .where(
                PlayerPointsForecast.snapshot_id == snapshot.id,
                PlayerPointsForecast.generated_at == latest_generated_at,
            )
            .order_by(
                PlayerPointsForecast.event,
                desc(PlayerPointsForecast.expected_points),
            )
        )
    )
@app.post("/v1/backtests/team-strength", response_model=BacktestReportRead)
def create_team_strength_backtest(
    request: TeamBacktestRequest,
    session: Session = Depends(get_session),
):
    try:
        return backtest_team_strength(
            session,
            request.dataset_ids,
            initial_training_gameweeks=request.initial_training_gameweeks,
        )
    except TeamModelError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/v1/backtests/team-strength/latest", response_model=BacktestReportRead)
def get_latest_team_strength_backtest(session: Session = Depends(get_session)):
    report = session.scalar(
        select(BacktestReport)
        .where(BacktestReport.model_type == TEAM_MODEL_TYPE)
        .order_by(desc(BacktestReport.created_at))
        .limit(1)
    )
    if not report:
        raise HTTPException(status_code=404, detail="No team-strength backtest is available")
    return report


@app.post("/v1/models/player-events/train", response_model=ModelRunRead)
def train_player_event_model(
    request: ModelTrainRequest,
    session: Session = Depends(get_session),
):
    try:
        return train_player_events(
            session,
            request.dataset_ids,
            minimum_history=request.minimum_history,
        )
    except PlayerEventModelError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/v1/models/player-events/latest", response_model=ModelRunRead)
def get_latest_player_event_model(session: Session = Depends(get_session)):
    model_run = latest_player_event_model(session)
    if not model_run:
        raise HTTPException(status_code=404, detail="No player-event model is available")
    return model_run


@app.post("/v1/backtests/player-events", response_model=BacktestReportRead)
def create_player_event_backtest(
    request: BacktestRequest,
    session: Session = Depends(get_session),
):
    try:
        return backtest_player_events(
            session,
            request.dataset_ids,
            initial_training_gameweeks=request.initial_training_gameweeks,
        )
    except PlayerEventModelError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/v1/backtests/player-events/latest", response_model=BacktestReportRead)
def get_latest_player_event_backtest(session: Session = Depends(get_session)):
    report = session.scalar(
        select(BacktestReport)
        .where(BacktestReport.model_type == PLAYER_EVENT_MODEL_TYPE)
        .order_by(desc(BacktestReport.created_at))
        .limit(1)
    )
    if not report:
        raise HTTPException(status_code=404, detail="No player-event backtest is available")
    return report
