# ADR 0005: Correlated player-points simulation

## Status

Accepted for the experimental 2026/27 prediction pipeline.

## Context

The earlier fixture blend produced only point estimates. It could not express haul probability, floor and ceiling, or the dependence between a clean sheet, goals conceded and bonus ranks. Bonus and defensive contributions were also hidden inside broad form signals.

The official 2026/27 rules retain two defensive-contribution points for defenders reaching 10 CBIT and midfielders/forwards reaching 12 CBIRT. Bonus remains match-ranked at 3/2/1 with official tie handling. The 2026/27 BPS reduces CBI weight to one BPS per three actions, removes the tackled penalty and revises goalkeeper-save inputs.

## Decision

Add a versioned `fpl-2026-27-v1` scoring module and a fixture-level Monte Carlo layer. Each simulation shares the same team scoreline, allocates player goals and assists within that scoreline, samples minutes states, and applies clean sheets, saves, cards, defensive-contribution thresholds and match-ranked bonus.

Normalized player snapshots retain the public per-90 inputs used by the event priors. Forecast rows retain seed, simulation count, percentiles, threshold probabilities, event probabilities, upstream model IDs, source checksum and the scoring-rules version.

Granular Opta BPS inputs are not available through the current approved public-data slice. Bonus therefore uses a transparent match-ranked proxy based on public BPS history and simulated events. The API and UI label this limitation; it must not be described as an exact Opta BPS reproduction.

## Consequences

- One- and three-Gameweek means now come from simulated fixture distributions when stored forecasts exist.
- The Player Lab can show floor, median, ceiling, haul, attacking-return, bonus and defensive-contribution probabilities.
- Re-running with the same input snapshot, upstream forecasts and seed is deterministic apart from record IDs and timestamps.
- Calibration against locked future outcomes and licensed granular event inputs remains required before the model is production-grade.
