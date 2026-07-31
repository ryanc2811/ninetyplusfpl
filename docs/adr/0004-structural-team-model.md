# ADR 0004: Start team forecasting with a time-decayed Poisson model

- Status: accepted
- Date: 2026-07-29

## Context

The fixture baseline uses FPL difficulty ratings, which are coarse and do not separately quantify scoring and clean-sheet potential. A first team model must be transparent, reproducible and useful with modest historical data.

## Decision

Estimate time-decayed attack strength, defensive weakness and home advantage with shrinkage toward league averages. Prefer xG as the historical target only when both teams have it; otherwise use goals. Combine strengths into independent Poisson home and away goal rates.

Persist expected goals, outcome probabilities, clean sheets, BTTS, over 2.5 goals and leading scorelines. Evaluate chronological folds against a league home/away average baseline. Keep the model experimental and enforce that its training cutoff precedes every forecast fixture.

## Consequences

- The model is easy to inspect and backtest.
- Promoted and unmatched teams receive neutral, lower-confidence priors.
- Independent Poisson assumptions do not capture low-score dependence, game state or player-level correlation.
- A Dixon-Coles adjustment and correlated Monte Carlo simulation remain later improvements.
