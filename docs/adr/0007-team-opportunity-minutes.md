# ADR 0007: Team-level opportunity adjustment for expected minutes

## Status

Accepted as an experimental model layer.

## Problem

Independent player forecasts reduce an injured player's expected minutes without
increasing the selection probability of likely replacements. In preseason this
can make an entire team's starting probabilities implausibly low and materially
understate FPL projections.

## Decision

Expected-minutes forecasts now include a post-model team opportunity layer:

1. Official availability fields identify unavailable players.
2. The unavailable player's established-role probability becomes a positional
   vacancy.
3. Source-attributed role signals allocate the vacancy when a credible
   replacement hierarchy is available.
4. Otherwise, the vacancy is distributed across the three leading available
   same-position candidates.
5. Start, substitute and zero-minute probabilities are rebalanced to remain
   exhaustive, and the evidence is stored with the forecast.

The web fallback and Python forecasting service use the same principles. A role
signal only activates while official availability also marks the player
unavailable, limiting the impact of stale news.

## Consequences

- Injuries can increase replacement expected minutes instead of merely removing
  minutes from the team.
- Forecast explanations identify the unavailable teammate and estimated
  opportunity share.
- Position-only replacement graphs remain coarse. Future versions should model
  formations, role subtypes, predicted line-ups and exactly eleven correlated
  starters per team.
- Source licensing, retrieval timestamps and expiry should move into a durable
  team-news ingestion pipeline before commercial launch.

