# ADR 0011: International tournament workload

## Status

Accepted as a mechanism. The signal table is deliberately incomplete.

## Problem

Players whose nation goes deep into a summer tournament return late, miss most
of pre-season and are eased back into club football. The model had no
representation of this at all: in a live preseason snapshot every England
international who had just played a World Cup semi-final was projected at a 98%
start probability, identical to a player who had rested all summer.

This is a Gameweek-one and Gameweek-two ranking error on some of the most-owned
players in the game.

## Decision

1. Model the effect on **minutes**, not on points. A returning player is not
   worse; they are benched, given an hour, or rotated. Applying the adjustment
   to expected minutes lets it propagate correctly into every scoring component,
   including defensive contribution, which needs a near-full match.
2. Key the signal on the official FPL `element.region` identifier. Region values
   were confirmed empirically by cross-referencing squad lists in the live feed
   rather than assumed from an external code list.
3. Express each nation as one row: the stage it reached, a confidence and a
   source. A per-stage peak impact halves each Gameweek and expires after
   Gameweek four, so a single number per nation drives the whole decay.
4. Redistribute the probability removed from starting into a substitute
   appearance rather than into zero minutes, since a rested player is usually
   named on the bench.
5. A nation absent from the table receives **no** adjustment.

## Consequences

- The table is data, not inference. It ships seeded only with England, on the
  operator's stated information that England reached at least the semi-final.
  Every other nation's run must be entered from a verified source before it
  affects any projection.
- An incomplete table degrades to the previous behaviour rather than inventing a
  tournament run, which is the correct failure mode for a product whose claim is
  transparency.
- Nation-level granularity is coarse. A squad player who did not feature is
  penalised the same as a starter who played every minute. Per-player tournament
  minutes would fix this and require a data source the public FPL feed does not
  provide.
- The stage impacts are judgement, not calibration. They should be backtested
  against realised opening-Gameweek minutes after a tournament season.
- The same mechanism generalises to other summer tournaments and to mid-season
  competitions such as the Africa Cup of Nations, which removes players outright
  rather than easing them back.
