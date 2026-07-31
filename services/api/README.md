# NINETY+ data API

This service captures reproducible FPL source snapshots and provides normalized reads for modelling and web replay.

## Why these dependencies

- FastAPI and Pydantic define a validated, documented HTTP contract.
- SQLAlchemy keeps persistence portable between local SQLite and target PostgreSQL.
- Alembic versions schema changes.
- HTTPX isolates official-FPL retrieval behind a provider.
- Pytest and deterministic source fixtures verify ingestion without depending on a live upstream.
- NumPy supplies bounded numerical operations and evaluation arrays.
- scikit-learn supplies the initial calibrated logistic classifier and ridge minute regressors.

## Run locally

From the repository root:

```bash
python3 -m venv services/api/.venv
services/api/.venv/bin/pip install -e 'services/api[dev]'
cd services/api
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload
```

The default database is `services/api/data/fpl.db` when commands run from this directory.

## Capture and replay

```bash
curl -X POST http://127.0.0.1:8000/v1/ingestions/fpl/current
curl http://127.0.0.1:8000/v1/snapshots/latest
curl http://127.0.0.1:8000/v1/snapshots/latest/export
```

Set `FPL_DATA_API_URL=http://127.0.0.1:8000` for the Next.js/vinext app to calculate its projections from the stored snapshot. Unset it to use the direct official source adapter.

## Expected Minutes v2

The first Python model predicts three mutually exclusive states—start, substitute appearance and zero minutes—then estimates minutes conditional on starting or appearing from the bench.

Training features use only matches before the target fixture:

- Rolling three- and five-match minutes
- Recent start, appearance, 60-minute and early-substitution rates
- Rest days
- Fixture difficulty and venue
- Position indicators

Training uses chronological train, calibration and locked test partitions. The persisted model run records feature names, dataset checksums, cutoffs, coefficients, calibration parameters, MAE, RMSE, Brier score, log loss and calibration error. JSON coefficients are stored instead of loading executable pickle artefacts.

Import and train an explicitly approved local CSV after applying migrations:

```bash
cd services/api
.venv/bin/python scripts/train_expected_minutes.py /absolute/path/history.csv \
  --source approved-provider \
  --season 2025-26 \
  --license-status licensed
```

Required logical fields are Gameweek, player ID, player name, position, team, opponent, fixture ID, kickoff timestamp, venue, difficulty, minutes, started and total points. Common Vaastav-style aliases such as `GW`, `element`, `name`, `team`, `opponent_team`, `fixture` and `starts` are accepted. The potentially leaky `xP` field is never used.

After training:

```bash
curl -X POST http://127.0.0.1:8000/v1/predictions/expected-minutes/latest
curl http://127.0.0.1:8000/v1/predictions/expected-minutes/latest
curl http://127.0.0.1:8000/v1/models/expected-minutes/latest
```

The model remains `experimental` until approved multi-season data is loaded and deadline-locked prospective forecasts demonstrate acceptable calibration.

## Multi-season identity and backtesting

FPL source player IDs are not assumed to remain stable between seasons. Imports create canonical player identities and seasonal aliases. Automatic matching requires an exact normalized full name and position. Position changes are linked but flagged for review; surname fallbacks are lower-confidence and also require review; ambiguous names remain unresolved.

Import each approved season separately:

```bash
cd services/api
.venv/bin/python scripts/import_historical_season.py /absolute/path/2024-25.csv \
  --source approved-provider --season 2024-25 --license-status licensed
.venv/bin/python scripts/import_historical_season.py /absolute/path/2025-26.csv \
  --source approved-provider --season 2025-26 --license-status licensed
```

Use the returned dataset IDs to train and run an expanding-window backtest:

```bash
curl -X POST http://127.0.0.1:8000/v1/models/expected-minutes/train \
  -H 'Content-Type: application/json' \
  -d '{"dataset_ids":["DATASET_2024","DATASET_2025"]}'

curl -X POST http://127.0.0.1:8000/v1/backtests/expected-minutes \
  -H 'Content-Type: application/json' \
  -d '{"dataset_ids":["DATASET_2024","DATASET_2025"]}'
```

Each fold trains on earlier Gameweeks, calibrates on the immediately preceding window and evaluates exactly one later Gameweek. The report compares v2 with a transparent rolling-history baseline and stores every fold, weighted aggregate metrics, dataset checksums and a pass/fail verdict. Player Lab displays the latest minutes MAE comparison when the stored provider is active.

Identity coverage is available from:

```bash
curl -X POST http://127.0.0.1:8000/v1/identities/latest/resolve
curl http://127.0.0.1:8000/v1/identities/latest/coverage
```

## Team-strength Poisson model

The initial structural match model learns time-decayed team attack strength, defensive weakness and home advantage. It prefers historical xG when both teams have it for a match and otherwise uses final goals. Strengths are shrunk toward league average, so promoted or unmatched teams receive a conservative prior rather than an invented rating.

Import an approved results file:

```bash
cd services/api
.venv/bin/python scripts/import_team_matches.py /absolute/path/matches.csv \
  --source approved-provider --season 2025-26 --license-status licensed
```

Logical fields are Gameweek, fixture ID, kickoff time, home team, away team, home goals and away goals. Optional `home_expected_goals` and `away_expected_goals` fields are supported.

Train, backtest and generate current fixture forecasts:

```bash
curl -X POST http://127.0.0.1:8000/v1/models/team-strength/train \
  -H 'Content-Type: application/json' \
  -d '{"dataset_ids":["MATCH_DATASET_ID"]}'

curl -X POST http://127.0.0.1:8000/v1/backtests/team-strength \
  -H 'Content-Type: application/json' \
  -d '{"dataset_ids":["MATCH_DATASET_ID"]}'

curl -X POST http://127.0.0.1:8000/v1/predictions/matches/latest
curl http://127.0.0.1:8000/v1/predictions/matches/latest
```

Outputs include expected goals, home/draw/away probabilities, clean sheets, both-teams-to-score, over 2.5 goals and the eight most likely scorelines. The web points baseline uses attacking xG for midfielders/forwards and weights clean-sheet probability more heavily for defenders/goalkeepers.

## Safety and scope

The ingestion endpoint performs a read-only fetch from public FPL web endpoints and writes only to the configured local database. It has no authentication and is intended for local development until rate limiting and authorization are added. Commercial source licensing must be confirmed separately.

Historical files are never downloaded automatically. The operator must supply a local file and choose `licensed`, `confirmed-open`, or `development-only`. That label is provenance metadata, not legal verification.
# Player-points simulation

Once expected-minutes and match forecasts have been generated, create reproducible
one-to-three Gameweek point distributions:

```bash
curl -X POST 'http://127.0.0.1:8000/v1/predictions/player-points/latest?simulations=2000&seed=2627&horizon=3'
```

`GET /v1/predictions/player-points/latest` returns the latest run. Forecasts use
the versioned 2026/27 rules, including defensive contributions and match-ranked
bonus, and retain their upstream model lineage. Bonus is an explicitly labelled
BPS proxy until granular licensed Opta inputs are available.

## Player-event priors

Historical player CSVs can include `goals_scored`, `assists`, `clean_sheets`,
`saves`, `yellow_cards`, `bonus`, `bps`, and `defensive_contributions`. Train
and backtest the experimental event model with:

```bash
.venv/bin/python scripts/train_player_events.py DATASET_ID
```

The model shrinks player rates towards position rates and evaluates each future
Gameweek using only earlier observations. Its Brier scores validate event
occurrence conditional on historical minutes; they are not a complete points
forecast backtest.
