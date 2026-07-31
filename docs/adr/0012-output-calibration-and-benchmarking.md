# ADR 0012: Output calibration and benchmark evaluation

## Status

Accepted.

## Problem

Projections sat consistently below an established competitor's, and the gap
grew with the projection: roughly -1.6 points on the top-projected forward,
-1.1 on a premium defender, but only -0.2 on a mid-priced forward. A gap that
scales with the projection is a systematic bias, not a set of per-player errors,
and cannot be corrected by adjusting individual players.

Measuring the model's inputs against the league's own realised output found two
causes, both biased in the same direction and both compounding at the top:

1. **Expected metrics were being paid out directly.** The projection scored
   `xG x points` and `xA x points`. But FPL pays for goals and assists as it
   awards them, and it awards assists far more generously than xA models them:
   pooled across the current snapshot, realised assists are **1.36x** expected
   assists. Goals track xG closely (**0.96x**), so the assist gap was the live
   one.
2. **The bonus curve was invented.** It was a sigmoid calibrated by intuition to
   "about one bonus point per start for a high-BPS regular". Against the
   league's realised bonus it was two to five times too low across its entire
   range — the single largest error in the model. Realised bonus per 90 for the
   top-projected forward is 1.31; the curve returned 0.64.

A third issue was structural rather than numerical: with three reference points
compared by eye, there was no way to tell a systematic bias from noise.

## Decision

**Score from realised output, not from expected metrics.** Each expected rate
becomes the *prior* for the matching realised rate, and the player's own output
is shrunk toward it. One principle covers goals, assists and bonus:

```text
rate = shrink(realised per 90, structural prior, minutes, pseudo-count)
```

Pseudo-counts differ by how repeatable each skill is: finishing is only weakly
persistent so it shrinks hard toward the league calibration, while bonus
accumulation is driven by role and set-piece duty and shrinks less.

**Fit the rate-to-output mapping from the snapshot, every time.** Goals per xG,
assists per xA and the BPS-to-bonus curve are all fitted from the current feed
rather than hardcoded, so the calibration tracks the league instead of a guess
made once. Ratios are pooled rather than averaged per player so a low-minute
outlier cannot move the estimate, and the bonus curve is binned and forced
monotone.

**Evaluate against reference projections, and never train on them.** Benchmarks
live in `data/benchmarks/`, are read only by `scripts/benchmark-report.mjs` and
the benchmark test, and a test asserts that no module under `lib/` imports
them. The report gives bias, mean absolute error, and — the useful part — bias
banded by projection size plus the slope of residual against reference value. A
non-zero slope is what identifies compression that overall bias hides.

Two secondary corrections came out of the same investigation:

- Defensive-contribution threshold crossings moved from Poisson to negative
  binomial. Real action counts are over-dispersed, so Poisson was wrong in a
  known direction, understating players whose average sits below the threshold.
- The fixture-difficulty mapping was widened. Promoted sides carry almost no
  Premier League minutes — one 2026/27 newcomer has none — so their rating comes
  entirely from that mapping, and the previous narrow spread put them close to
  league average.

## Consequences

- Measured against the three available reference points, bias moved from -0.97
  to +0.07 and mean absolute error from 0.97 to 0.47.
- Elite finishers and high-BPS players are no longer structurally underrated,
  because the model now pays for what they actually produce.
- The calibration is only as good as the snapshot it is fitted from. Early in a
  season, when per-90 rates are thin, it falls back to the previous season's
  totals that the feed still carries; the fitted values should be reviewed once
  a new season accumulates minutes.
- **Three benchmark rows cannot establish calibration.** The reported bias slope
  is not meaningful at that sample size. The harness is built; it needs
  populating before its output should be trusted.
- Matching a competitor exactly is explicitly not the goal. Converging on
  another model's numbers would remove any edge; the goal is the absence of
  systematic bias, which is measurable, rather than agreement, which is not
  useful.
- The negative-binomial dispersion factor remains an assumption. Per-match
  historical data would replace it with a fitted value, and that is the one
  remaining hand-chosen constant in the scoring path.
