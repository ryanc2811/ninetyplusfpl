# Focused prediction-pipeline review

## Fixed in this phase

1. **Double Gameweek leakage** — feature construction previously appended one fixture result before building the next row in the same Gameweek. All rows under one season/Gameweek deadline are now featurized before any result in that group enters history.
2. **Future-history leakage** — current expected-minutes forecasts previously loaded every matched historical observation. Forecast features now retain only observations with kickoff times before the target fixture.
3. **Model-cutoff enforcement** — expected-minutes and team forecasts now fail closed when a model was trained on data at or after the target fixture.
4. **Coarse fixture-only scoring** — player projections can now use structural expected goals and clean-sheet probabilities, with position-specific weighting and a tested fallback.

## Important remaining improvements

- Mutation endpoints are intentionally unauthenticated for local development; production requires authorization, rate limiting and job-level permissions.
- Historical licensing status is operator-supplied metadata, not automated legal verification.
- Historical team names currently need provider-consistent codes; canonical team identity and aliases should be added before mixing providers.
- Independent Poisson scorelines miss draw/low-score dependence and game-state effects.
- Player goals, assists, saves, cards and bonus probabilities are still baseline inputs rather than separately trained event models.
- SQLite is only the exercised local fallback; production concurrency and analytical workloads require PostgreSQL.
- CI, scheduled jobs, monitoring and deadline-lock orchestration remain unimplemented.
