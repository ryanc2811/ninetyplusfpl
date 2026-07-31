# ADR 0001: Migrate modelling behind an incremental service boundary

- Status: accepted
- Date: 2026-07-29

## Context

The current product is a working Next.js/vinext prototype. Rebuilding it immediately as a monorepo with Python, PostgreSQL and multiple services would destabilise useful UI and delay a tested end-to-end capability. Keeping all numerical work in route handlers would, however, make modelling, reproducibility and scientific validation increasingly difficult.

## Decision

Preserve the existing web application and introduce versioned domain contracts plus provider interfaces now. Implement the first expected-minutes baseline in TypeScript to establish the contract and user experience. Move numerical prediction to a FastAPI service incrementally after durable snapshots and temporal test data exist.

PostgreSQL will become the analytical system of record; immutable raw snapshots and model artefacts will use object storage. D1 will not become the primary prediction database.

## Consequences

- Existing product work remains usable.
- Python migration can occur endpoint by endpoint behind contract tests.
- The current baseline must remain explicitly labelled and versioned.
- Duplicate TypeScript/Python logic is acceptable only during a short, tested migration window.
- A pnpm/Turborepo conversion is deferred until multiple applications or shared packages justify its cost.
