/**
 * International tournament workload.
 *
 * Players whose nation goes deep into a summer tournament return to their clubs
 * late and miss most of pre-season. The effect on Fantasy scoring is not that
 * they play worse — it is that they are eased back in: benched for the opener,
 * given an hour rather than ninety minutes, rotated through the first few
 * Gameweeks. That is a *minutes* effect, so it is applied to the expected-
 * minutes projection rather than to points directly.
 *
 * The table below is deliberately small and source-attributed. A nation with no
 * entry receives no adjustment, so an incomplete table degrades to the previous
 * behaviour rather than inventing one. Region identifiers are the official FPL
 * `element.region` values, confirmed by cross-referencing squad lists in the
 * live feed.
 *
 * OPERATOR NOTE: only nations that have been explicitly verified belong here.
 * Add an entry per nation that reached the knockout rounds, with the date it
 * was eliminated and the source used. Do not guess a run.
 */

import type { ExpectedMinutesProjection } from "./contracts/fpl.ts";

export type TournamentStage =
  | "winner"
  | "finalist"
  | "semi-final"
  | "quarter-final"
  | "round-of-16"
  | "group";

export type NationWorkloadSignal = {
  regionId: number;
  nation: string;
  stage: TournamentStage;
  confidence: number;
  source: string;
};

/**
 * Peak reduction in start probability for the first affected Gameweek. Halves
 * each subsequent Gameweek, so the effect is spent within roughly a month.
 */
const STAGE_IMPACT: Record<TournamentStage, number> = {
  winner: 0.30,
  finalist: 0.28,
  "semi-final": 0.22,
  "quarter-final": 0.12,
  "round-of-16": 0.05,
  group: 0,
};

const DECAY_PER_GAMEWEEK = 0.5;

/**
 * Minutes a returning starter is held back when they do start, at full impact.
 * Scales with the same decay as the start-probability reduction.
 */
const PEAK_MINUTES_WITHHELD = 16;

export type TournamentWorkload = {
  tournament: string;
  /** First Gameweek the adjustment applies to. */
  firstGameweek: number;
  /** Gameweeks after which no adjustment is applied at all. */
  lastGameweek: number;
  signals: NationWorkloadSignal[];
};

export const INTERNATIONAL_WORKLOAD: TournamentWorkload = {
  tournament: "FIFA World Cup 2026",
  firstGameweek: 1,
  lastGameweek: 4,
  signals: [
    {
      regionId: 241,
      nation: "England",
      stage: "semi-final",
      confidence: 0.6,
      source: "operator-supplied: England reached at least the semi-final",
    },
  ],
};

export type WorkloadImpact = {
  nation: string;
  stage: TournamentStage;
  startProbabilityMultiplier: number;
  minutesWithheld: number;
  confidence: number;
  reason: string;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Returns the workload adjustment for a nation in a given Gameweek, or null
 * when the nation is not in the table or the effect has expired.
 */
export function workloadImpact(
  regionId: number | null | undefined,
  gameweek: number,
  workload: TournamentWorkload = INTERNATIONAL_WORKLOAD,
): WorkloadImpact | null {
  if (regionId === null || regionId === undefined) return null;
  if (gameweek < workload.firstGameweek || gameweek > workload.lastGameweek) return null;
  const signal = workload.signals.find((entry) => entry.regionId === regionId);
  if (!signal) return null;

  const peak = STAGE_IMPACT[signal.stage];
  if (peak <= 0) return null;

  const elapsed = gameweek - workload.firstGameweek;
  const reduction = peak * DECAY_PER_GAMEWEEK ** elapsed;
  if (reduction < 0.01) return null;

  return {
    nation: signal.nation,
    stage: signal.stage,
    startProbabilityMultiplier: 1 - reduction,
    minutesWithheld: PEAK_MINUTES_WITHHELD * DECAY_PER_GAMEWEEK ** elapsed,
    confidence: signal.confidence,
    reason:
      `${signal.nation} reached the ${signal.stage.replace(/-/g, " ")} of the ${workload.tournament}; `
      + `a late return and missed pre-season reduce the GW${gameweek} start probability by `
      + `${Math.round(reduction * 100)}% and shorten the expected outing.`,
  };
}

/**
 * Applies a workload impact to an expected-minutes projection, preserving the
 * invariant that start, substitute and zero-minute probabilities sum to 100.
 * Probability removed from starting is redistributed to a substitute
 * appearance, since a rested player is usually named on the bench rather than
 * left out of the squad entirely.
 */
export function applyWorkload(
  projection: ExpectedMinutesProjection,
  impact: WorkloadImpact,
): ExpectedMinutesProjection {
  const originalStart = projection.startProbability / 100;
  if (originalStart <= 0) return projection;

  const nextStart = clamp(originalStart * impact.startProbabilityMultiplier, 0, 0.98);
  const released = originalStart - nextStart;
  const nextSubstitute = clamp(
    projection.substituteProbability / 100 + released * 0.75,
    0,
    1 - nextStart,
  );
  const minutesIfStart = clamp(
    projection.expectedMinutesIfStart - impact.minutesWithheld,
    45,
    90,
  );
  const startPercent = Math.round(nextStart * 100);
  const substitutePercent = Math.round(nextSubstitute * 100);
  const sixtyGivenStart = clamp((minutesIfStart - 48) / 25, 0.25, 0.99);

  return {
    ...projection,
    startProbability: startPercent,
    substituteProbability: substitutePercent,
    zeroMinutesProbability: Math.max(0, 100 - startPercent - substitutePercent),
    expectedMinutesIfStart: Number(minutesIfStart.toFixed(1)),
    expectedMinutes: Number(
      (nextStart * minutesIfStart + nextSubstitute * projection.expectedMinutesIfSubstitute)
        .toFixed(1),
    ),
    sixtyMinuteProbability: Math.round(nextStart * sixtyGivenStart * 100),
    earlySubstitutionProbability: Math.round(nextStart * (1 - sixtyGivenStart) * 100),
    confidence: Math.round(
      clamp(Math.min(projection.confidence / 100, impact.confidence + 0.2) * 100, 18, 94),
    ),
    reasons: [...projection.reasons, impact.reason],
    modelVersion: "expected-minutes-workload-v1",
  };
}

export const WORKLOAD_MODEL_VERSION = "international-workload-v1";
