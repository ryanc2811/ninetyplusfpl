# ADR 0009: Preseason points priors and the Bench Boost objective

## Status

Accepted as an experimental calibration improvement.

## Problem

The preseason points baseline ignored prior-season points per game and minutes,
even when the official feed supplied them. It therefore relied too heavily on
price. Separately, the Bench Boost optimiser added the raw difference between a
three-Gameweek score and a one-Gameweek score to its GW1 objective. That allowed
future value to dominate the week in which the chip was actually active.

The optimiser also used only one-player upgrades from a minimum-price starting
squad. It could become trapped with several weak fillers because moving money
from one premium into two balanced upgrades requires a simultaneous exchange.

## Decision

1. Preseason points blend prior-season points per game according to the amount
   of historical minutes available.
2. Official expected points and price remain lower-weight priors.
3. GW1 Bench Boost values all fifteen GW1 projections, captaincy and a 12%
   discounted contribution from GW2–3 coverage.
4. Bench Boost squad search can evaluate two-player exchanges after all
   profitable single-player exchanges are exhausted.
5. The two-player search uses a bounded candidate pool and an additive Bench
   Boost objective to remain suitable for the client.

## Consequences

- Established players no longer lose their prior-season evidence at the season
  boundary.
- The optimiser cannot label a lower-GW1 squad optimal merely because it has a
  much larger unscaled three-week total.
- Balanced Bench Boost squads can escape the premium-plus-filler local optimum.
- The 12% future-coverage weight is a strategic assumption and must eventually
  be backtested against season outcomes and alternative early-Wildcard plans.
- This remains an expected-value forecast, not a target score or a calibration
  to a competitor's published number.
