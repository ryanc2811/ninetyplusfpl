# ADR 0003: Conservative cross-season player identity resolution

- Status: accepted
- Date: 2026-07-29

## Context

FPL element IDs are source- and season-specific. Joining history to current players by the numeric ID can silently attach no history or, worse, the wrong player. Names can also change spelling, contain diacritics, collide or accompany an FPL position reclassification.

## Decision

Introduce canonical player identities, source-season aliases and snapshot mappings. Normalize Unicode names deterministically, but automatically join only a unique exact full-name and position match.

Unique exact names with a changed position and unique surname fallbacks may be linked for continuity, but must be marked `review-required`. Ambiguous and invalid names remain unresolved. Every link retains method and confidence so future manual overrides or stronger provider identifiers can supersede it.

Backtests group observations by canonical identity and preserve season/Gameweek ordering. Existing observations are backfilled through the same audited resolver.

## Consequences

- Cross-season features no longer depend on unstable element IDs.
- Resolution coverage becomes a measurable data-quality gate.
- Some real players will intentionally lack history until reviewed.
- Date of birth or licensed provider identifiers should replace name matching when available.
