# Architecture and delivery plan

## Current-state assessment

NINETY+ is a single Next.js App Router application using React 19, strict TypeScript, Tailwind CSS and vinext for Cloudflare Worker/Sites output. It has a polished responsive product shell, an official-FPL adapter route, 563-player coverage, a fixture-aware points baseline and an unused but security-conscious ChatGPT identity helper.

The application does not yet have durable prediction storage, user accounts, team import, a historical warehouse, locked deadline forecasts, backtesting, independent services, CI, observability or a trained model. The existing D1 schema is empty and the old tests still targeted starter code before this phase. Numerical logic currently executes in TypeScript and should be treated as a transparent baseline.

## Security and data findings

- No FPL credentials are collected.
- No application secrets are committed.
- Public FPL data retrieval is now behind an interface, but commercial terms still require review.
- The API is read-only and cached; rate limiting is not yet present.
- Source checksum and retrieval metadata are returned, but immutable source snapshots are not yet stored.
- Authentication helpers exist, but no route currently requires identity.
- Dependency audit currently reports known transitive vulnerabilities; remediation must be reviewed without forcing breaking upgrades.

## Target architecture

Keep the existing web application stable while introducing clear boundaries:

```text
Next.js web
  -> generated/versioned prediction contract
  -> FastAPI prediction API
      -> PostgreSQL normalised data + prediction snapshots
      -> object storage immutable raw snapshots/model artefacts
      -> Redis short-lived cache
      -> Python ingestion, expected-minutes, match and simulation jobs
```

PostgreSQL and object storage are the target analytical system of record. D1 remains suitable only for the current hosted prototype or small application metadata; it should not become the core prediction warehouse. Python services can be added safely because the frontend now consumes an explicit contract. A gradual migration is preferable to an immediate pnpm/Turborepo restructure.

## Gap analysis

| Capability | Current | Target gap |
| --- | --- | --- |
| Source ingestion | Live adapter plus immutable local snapshots | Licensed providers, retries, object-storage replication |
| Data model | SQLAlchemy/Alembic normalized snapshot schema | Managed PostgreSQL and historical loaders |
| Expected minutes | Python v2, canonical identities and expanding backtests | Approved real multi-season data and prospective calibration |
| Points | Shrunk historical event priors and correlated Monte Carlo implemented | Richer licensed event data and prospective end-to-end evaluation |
| Validation | Unit and quality gates | Temporal backtests, calibration and locked forecasts |
| API contract | Shared TypeScript contract | OpenAPI contract generated from FastAPI |
| Product | Dashboard and Player Lab | Import, player profile, comparison and planner |
| Operations | Manual build | CI/CD, scheduled jobs, telemetry and incident controls |

## Phased implementation plan

1. **Foundation and trust** — complete validation, ADRs, provider boundary and honest baseline lab.
2. **Data platform** — SQLAlchemy/Alembic snapshots, normalization, provenance and stored replay implemented; managed PostgreSQL, object-storage replication and historical loaders remain.
3. **Expected minutes v2** — Python recent-match features, temporal evaluation, calibration, model lineage and prediction endpoints implemented; approved multi-season training and prospective validation remain.
4. **Team and points baseline** — Poisson team model, player event probabilities and correlated Monte Carlo outputs.
5. **Functional web MVP** — editable rules-aware squad builder completed; team-ID import, profiles, comparisons and fixture ticker remain.
6. **Planning and optimisation** — transfer branches, budget/selling values, captaincy, chips and OR-Tools optimiser.
7. **Differentiation** — forecast change log, decision lab, news-to-numbers, journal and public accuracy.
8. **Commercial hardening** — entitlements, privacy, rate limiting, observability, recovery and controlled beta.

## Implemented slice: expected-minutes baseline v1

User outcome: a manager can see estimated playing time and why the baseline believes it, rather than receiving an unexplained points number.

Acceptance criteria:

- Start, substitute, zero-minute, 60-minute and early-substitution probabilities are bounded.
- Start + substitute + zero-minute probabilities equal 100%.
- Expected minutes remain between 0 and 90.
- Official availability reduces expected minutes.
- Every live response includes model version, retrieval time, checksum and quality status.
- The UI labels the calculation as a baseline and displays structured evidence.
- Typecheck, lint, unit tests and production build pass.

## Implemented slice: reproducible data platform

User outcome: current official FPL data can be captured once, replayed consistently and inspected with its source metadata instead of changing underneath every calculation.

Acceptance criteria:

- Alembic creates season, Gameweek, raw snapshot, player, team and fixture tables.
- Raw payloads receive a deterministic SHA-256 checksum and duplicate ingestion is idempotent.
- Quality gates reject incomplete or internally inconsistent provider payloads.
- Normalized rows retain the immutable snapshot identifier.
- FastAPI exposes health, ingestion, summary, player and full replay endpoints.
- The existing web route can switch to stored replay through `FPL_DATA_API_URL`.
- Deterministic fixtures cover ingestion, quality rejection and read API behavior.

## Implemented slice: Expected Minutes v2

User outcome: expected playing time can now be trained and evaluated independently using only information that existed before each target match.

Acceptance criteria:

- Historical imports are checksummed, idempotent and carry explicit source/licensing metadata.
- Feature construction uses only earlier player observations.
- Train, calibration and test partitions are ordered by Gameweek.
- The classifier returns exhaustive start, substitute and zero-minute probabilities.
- Conditional minute regressors keep outputs within FPL match bounds.
- Brier score, log loss, start/zero accuracy, calibration error, MAE and RMSE are retained.
- Model coefficients, calibration, features, source checksums and time cutoffs are reproducible JSON.
- Forecasts retain snapshot ID, model run, generated time, confidence, features and structured reasons.

## Implemented slice: cross-season identity and expanding backtests

User outcome: a player’s history can follow them across changing season-specific IDs, and model performance is compared over multiple genuinely future Gameweeks instead of one convenient holdout.

Acceptance criteria:

- Canonical identities and source-season aliases preserve lineage.
- Exact full-name/position matches are automatic; lower-confidence and ambiguous matches are visible.
- Current snapshot players are linked before forecasts are generated.
- Historical observations from earlier schema revisions are backfilled safely.
- Expanding folds train, calibrate and test in chronological order.
- V2 and rolling-history baseline metrics are evaluated on identical locked rows.
- Fold metrics, weighted aggregates, verdict and dataset checksums are persisted.
- Identity coverage and backtest reports are available through typed APIs.
- Player Lab shows the latest model-versus-baseline minutes MAE.

## Implemented slice: correlated player-points simulation

User outcome: rankings now expose a range of plausible FPL scores and the specific routes to points, including bonus and defensive contributions.

Acceptance criteria:

- Scoring is pinned to `fpl-2026-27-v1`.
- Defensive contribution applies at 10 CBIT for defenders and 12 CBIRT for midfielders/forwards, capped at two points per match.
- Bonus is ranked within each simulated match and handles official tie cases.
- Match goals, player events, clean sheets and goals conceded share the same simulation path.
- Forecasts expose mean, median, p10, p90 and 2+/5+/10+/15+ probabilities.
- Goal, assist, clean-sheet, bonus and defensive-contribution probabilities are stored separately.
- Seeds, upstream model runs, snapshot checksums and limitations are retained.
- Player Lab uses simulated means and displays the distribution when stored forecasts exist.

## Implemented slice: leakage-safe player-event priors

User outcome: goal, assist, save, card, bonus and defensive-action priors can
learn from approved historical player outcomes instead of relying primarily on
static position assumptions.

Acceptance criteria:

- Historical imports retain individual player-event outcomes.
- Player rates shrink towards position priors to control small samples.
- Locked holdouts and expanding folds never train on the target Gameweek.
- Event occurrence is scored with Brier metrics against a position-only baseline.
- Save and BPS count errors are retained separately.
- Unmatched current players receive trained position rates.
- Public current rates and trained history are blended transparently.
- Every points forecast retains the event-model run and version.

## Next recommended slice

Add locked forecast snapshots and an accuracy ledger that grades complete
expected-points distributions after each Gameweek, then surface model changes
and calibration history in the product.

## Implemented slice: team-strength Poisson model

User outcome: player projections can respond to explicit team scoring and clean-sheet probabilities rather than only a five-level fixture label.

Acceptance criteria:

- Approved historical results are checksummed, idempotent and source-labelled.
- Time decay and shrinkage prevent old or small samples dominating.
- Unknown teams receive a visible neutral prior.
- Training and expanding backtests are chronological.
- Forecasts include xG, W/D/L, clean sheets, BTTS, over 2.5 and scorelines.
- Model lineage and backtest comparisons are persisted.
- Stored match forecasts adjust player projections by position.
- Player Lab exposes team xG and clean-sheet evidence.
- Training cutoffs are enforced before forecast fixtures.

## Implemented slice: functional squad builder

User outcome: a manager can replace any squad asset from the live player market and immediately see budget, club-limit, formation, XI, bench and captaincy consequences.

Acceptance criteria:

- Squad remains 2 GK, 5 DEF, 5 MID and 3 FWD.
- Replacements are position-safe, duplicate-safe, within £100m and within three players per club.
- All eight valid FPL formations can be selected.
- The highest-projected legal XI can be chosen without changing the 15-player squad.
- Captain, vice-captain and bench order are editable.
- Dashboard projection and bank values react to builder state.
- Builder rules have independent unit tests.
