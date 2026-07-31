# ADR 0010: Additive component points model in the web baseline

## Status

Accepted, replacing the multiplicative `fixture-blend-v4` baseline.

## Problem

The shipping web projection multiplied a scalar baseline by a role factor, a
fixture factor and a venue factor. Four defects followed from that shape.

1. The role factor was `0.36 + (expectedMinutes / 90) * 0.64`. A player with zero
   expected minutes retained 36% of their baseline, so 47 unavailable players in
   a live snapshot were projected at one point or more and remained eligible for
   the squad builder and transfer radar.
2. In preseason the baseline returned prior-season points per game blended
   toward a price prior, and the computed `positionSignal` carrying xG, xA,
   clean-sheet and defensive-contribution rates was never read. The richest data
   in the feed was discarded exactly when no current-season data existed.
3. The fixture multiplier scaled the whole total, including appearance points,
   which do not depend on the opponent.
4. Points per game is a consequence of underlying rates and minutes, not
   independent evidence, so using it as the primary signal double-counted
   minutes and lagged role changes.

The trained Monte Carlo model in the Python service already decomposes scoring
correctly, but it only reaches users when `FPL_DATA_API_URL` is configured and
models are trained. The default path is the TypeScript baseline.

## Decision

Project expected points as the sum of the FPL scoring events that produce them:

```text
xP = appearance + goals + assists + clean sheet + defensive contribution
   + saves + bonus - goals conceded - cards
```

1. Per-event point values are read from `game_config.scoring` in the live
   bootstrap, with the published 2026/27 values as a fallback. Two divisors
   (one point per three saves, minus one per two conceded) and the
   defensive-contribution thresholds are not expressible in that payload and are
   named constants.
2. Per-90 rates are shrunk toward position-and-price priors in proportion to the
   minutes behind them, using an 810-minute pseudo-count.
3. Team attack strength is the minutes-weighted sum of squad xG/90; team defence
   is the minutes-weighted mean of squad xGC/90. Both are normalised to the
   league average and shrunk toward it by squad evidence, with the official
   fixture-difficulty rating blended in as that evidence falls away.
4. Expected goals for and against are Poisson; clean sheets are the zero-goal
   mass and the concession penalty is the expected count of completed pairs.
5. Defensive contribution is the Poisson probability of crossing the positional
   threshold, conditioned on starting.
6. Bonus is a smooth monotone fit on BPS per 90. It is an approximation, since
   bonus is a within-match rank statistic.
7. A stored match forecast from the trained team model overrides the derived
   fixture expectation wherever one exists.
8. Points per game and official `ep_next` are no longer inputs.

## Consequences

- A player who cannot play projects zero, not a fraction of a baseline.
- Underlying rates drive preseason projections, which is the main accuracy gap
  against established competitors.
- Goalkeeper projections now trade save points against clean-sheet points, which
  a single scalar could not express.
- Every projection carries a component breakdown, so a manager can see where the
  number comes from rather than being asked to trust it.
- Team ratings for promoted sides rest largely on the official difficulty
  rating until Premier League minutes accumulate.
- Defensive actions are modelled as Poisson. Real counts are over-dispersed, so
  the threshold probability is conservative for players below the line. A
  negative-binomial form needs per-match historical data to calibrate a
  dispersion parameter and is deliberately deferred rather than guessed.
- Bonus remains the weakest component and should move to a trained within-match
  rank model.
- This is still an expected-value baseline, not a trained production model, and
  has not been backtested against realised season outcomes.
