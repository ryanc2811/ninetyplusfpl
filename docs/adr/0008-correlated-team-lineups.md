# ADR 0008: Correlated team-lineup expected minutes

## Status

Accepted as an experimental preseason model layer.

## Problem

Independent player forecasts do not conserve starting places. A club can appear
to have far fewer or more than eleven expected starters, especially before any
current-season minutes exist. This depresses projections for credible starters,
overstates fringe players and makes comparisons between teammates inconsistent.

## Decision

Expected-minutes forecasts now include a post-model lineup constraint:

1. It runs only for club rosters with at least fifteen modelled players.
2. It evaluates every legal FPL formation from 3-4-3 through 5-2-3.
3. Player role scores blend the underlying start forecast, observed start rate,
   price and ownership priors.
4. Official availability caps each player's probability.
5. A smooth positional allocation conserves approximately eleven expected
   starters across the inferred formation.
6. Start, substitute, zero-minute, sixty-minute and expected-minute values are
   recalculated together.

The TypeScript fallback and Python forecasting service implement the same
constraint. The earlier injury-opportunity layer runs first, so verified
replacement information influences the inferred lineup rather than being
discarded.

## Consequences

- Club-level selection probabilities are coherent and formation-aware.
- Unavailable players remain excluded while their replacements can rise.
- Explanations expose the inferred formation and positional rank.
- Price and ownership are deliberately weak preseason priors, not claims about
  real manager selections.
- Accuracy must be validated with timestamped historical predicted lineups and
  actual starts. A licensed, expiring team-news feed should replace static role
  signals before commercial launch.
