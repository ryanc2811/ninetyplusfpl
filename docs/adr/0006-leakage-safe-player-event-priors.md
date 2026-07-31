# ADR 0006: Leakage-safe player-event priors

## Status

Accepted as an experimental input to the 2026/27 points simulator.

## Context

The first Monte Carlo slice used current public per-90 values where available and transparent position fallbacks otherwise. Historical imports retained minutes and total points but discarded the goal, assist, save, card, bonus, BPS and defensive-action outcomes required to evaluate those priors.

Sparse player samples are especially dangerous in pre-season. An unshrunk rate can treat one goal in limited minutes as a stable scoring level, while a position-only prior ignores meaningful player history.

## Decision

Historical player-Gameweek observations now retain the individual event outcomes supplied by an approved source. The player-event model estimates position rates and player rates per 90 minutes, shrinking every player towards their position prior with 900 equivalent prior minutes.

Training reserves the latest Gameweeks as a locked temporal holdout. Backtesting uses expanding windows: every test Gameweek is predicted only from earlier Gameweeks. The primary comparison is the mean Brier score across goal, assist, yellow-card, bonus and defensive-contribution occurrence, with save and BPS mean absolute errors also retained.

The Monte Carlo simulator uses the latest player-event run automatically. A public current-season rate is blended with the trained rate; missing or unmatched players use the trained position rate before the static fallback. Every points forecast records the event-model run and version.

## Boundaries

- This evaluates event intensity conditional on actual historical minutes; it is not an end-to-end points backtest.
- Bonus remains a match-ranked BPS proxy until licensed granular Opta inputs are available.
- A historical source being recorded as licensed or open is an operator assertion and must be verified before commercial use.
- Prospective locked forecasts remain necessary before describing the model as production-calibrated.
