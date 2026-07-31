# ADR 0002: Leakage-safe expected-minutes training and data rights

- Status: accepted
- Date: 2026-07-29

## Context

Expected minutes drives every downstream FPL prediction, but the application is currently pre-season and the live 2026/27 feed has no completed-match labels. Community historical datasets are useful for development, yet an open-source repository license may not grant commercial rights to the underlying FPL or third-party data. Some post-Gameweek fields, particularly scraped `xP`, may also contain information unavailable at the deadline.

## Decision

Use a provider-independent local CSV importer that requires source, URI, season, checksum and explicit licensing status. Do not automatically download community data or treat an operator-entered status as legal verification.

Build each training row from observations strictly before its target fixture. Exclude `xP` entirely. Split by ordered season/Gameweek into training, calibration and locked test periods. Store model coefficients and calibration parameters as JSON rather than executable pickle files.

Keep the model status `experimental` until approved multi-season data and prospective deadline-locked evaluation are available.

## Consequences

- The pipeline can be tested completely without distributing third-party historical data.
- Data approval is a visible promotion gate.
- Reported holdout metrics are meaningful but cannot support market-leading claims.
- Cross-season player identity resolution and pre-deadline injury/team-news features remain necessary.
