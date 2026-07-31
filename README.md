# NINETY+

NINETY+ is a transparent Fantasy Premier League prediction and decision-support application for the 2026/27 season.

The current product is an early baseline—not a trained production AI model. It retrieves current public FPL player, team and fixture data, applies versioned expected-minutes and fixture baselines, and exposes structured evidence in the Player Lab.

## Current vertical slice

- Provider-independent FPL source adapter
- Retrieval provenance and source checksum
- Player, team and fixture quality gates
- Expected-minutes probabilities and evidence
- One- and three-Gameweek baseline projections
- Typed TypeScript API contract
- Responsive prediction table with loading, fallback, empty and “Why?” states
- Functional rules-aware squad builder with live same-position replacements
- Budget, squad composition and three-per-club enforcement
- Formation, XI, bench-order, captain and vice-captain controls
- Immutable, checksummed raw snapshots in a Python data service
- Normalized season, Gameweek, team, player and fixture snapshot tables
- Idempotent ingestion with data-quality gates
- Web projection route can replay the latest stored snapshot
- Historical player-Gameweek CSV ingestion with explicit licensing status
- Leakage-safe rolling expected-minutes features
- Temporally split, calibrated start/substitute/zero-minute model
- Conditional start and substitute minute regressors
- Stored model lineage, holdout metrics and current-player forecasts
- Cross-season canonical player identities with confidence and review status
- Expanding-window model-vs-baseline backtests surfaced in Player Lab
- Time-decayed team attack and defence strengths
- Poisson expected goals, outcomes, clean sheets and scoreline probabilities
- Structural match probabilities now adjust player point projections
- Versioned 2026/27 scoring, including defensive-contribution thresholds
- Fixture-correlated Monte Carlo player points with reproducible seeds
- Mean, median, p10/p90 and 2+/5+/10+/15+ outcome probabilities
- Explicit goal, assist, clean-sheet, bonus and defensive-contribution probabilities
- Leakage-safe historical player-event training with player-to-position shrinkage
- Expanding-window event-probability backtests and persisted model lineage

## Local development

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Validation:

```bash
npm run typecheck
npm run lint
npm test
```

The local data service requires Python `>=3.9`. It defaults to SQLite for zero-infrastructure development; the SQLAlchemy/Alembic schema is PostgreSQL-compatible.

```bash
python3 -m venv services/api/.venv
services/api/.venv/bin/pip install -e 'services/api[dev]'
cd services/api
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload
```

Ingest a current snapshot with `POST http://127.0.0.1:8000/v1/ingestions/fpl/current`, then set `FPL_DATA_API_URL=http://127.0.0.1:8000` before starting the web app. Without that setting, the web app continues to use the direct official-FPL provider.

Expected Minutes v2 is currently marked **experimental**. It is a complete training and inference pipeline, but it must be trained on approved multi-season data and evaluated prospectively before replacing the web baseline. See the [data service guide](services/api/README.md).

The team-strength model is also experimental. Player Lab uses its team expected goals and clean-sheet probabilities when stored match forecasts exist, while retaining the FPL fixture-difficulty fallback.

After expected-minutes and match forecasts exist, generate the next three Gameweeks of probabilistic player forecasts with:

```bash
curl -X POST 'http://127.0.0.1:8000/v1/predictions/player-points/latest?simulations=2000&seed=2627&horizon=3'
```

When an approved historical player dataset includes event columns, train and
backtest the priors before generating points:

```bash
cd services/api
.venv/bin/python scripts/train_player_events.py DATASET_ID
```

Supported historical outcomes include goals, assists, clean sheets, saves,
yellow cards, bonus, BPS and defensive contributions. Old v1 imports are
backfilled when the same source CSV is imported again after migration `0006`.

The points simulator uses the official 2026/27 scoring thresholds and match-ranked bonus allocation. Its BPS input is currently a transparent proxy because the public feed does not contain every granular Opta action used by the live BPS calculation. It is an experimental forecast, not an exact reconstruction of official bonus.

## Important boundaries

- Never request or store an FPL password.
- Public manager imports should use an FPL team ID.
- The public FPL web endpoints are isolated behind a provider interface; licensing and commercial-use suitability must be confirmed before commercial launch.
- Raw snapshot rows are immutable by application convention and checksummed. Object-storage replication and database-level append-only enforcement remain production requirements.
- The historical loader requires an explicit licensing status. This records an operator assertion; it does not itself grant or verify commercial data rights.
- Numerical modelling will migrate incrementally behind a versioned API contract to Python services; the existing web app should not be rewritten wholesale.
- No secrets belong in source control.

See [docs/architecture-plan.md](docs/architecture-plan.md) and [ADR 0001](docs/adr/0001-incremental-service-boundary.md).
