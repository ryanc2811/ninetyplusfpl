/**
 * International tournament workload and reported availability.
 *
 * Players whose nation goes deep into a summer tournament return late and miss
 * most of pre-season. The effect on Fantasy scoring is not that they play
 * worse — they are eased back in: benched for the opener, given an hour rather
 * than ninety minutes, rotated through the opening weeks. That is a *minutes*
 * effect, so it is applied to the expected-minutes projection and propagates
 * from there into every scoring component.
 *
 * This reads a versioned, source-attributed dataset rather than inferring a
 * tournament run from a player's nationality. Two rules come from the dataset
 * itself and are honoured here:
 *
 * - a confirmed injury or rehabilitation overrides fatigue modelling;
 * - squad members who played little or nothing are not penalised for having
 *   been selected.
 *
 * The official FPL availability field always wins where it is more pessimistic,
 * because it is live and this dataset is a dated snapshot.
 */

import type { ExpectedMinutesProjection } from "./contracts/fpl.ts";
import riskData from "../data/reference/world-cup-2026-gw1-risk.json" with { type: "json" };

export type WorkloadRecord = {
  player: string;
  club: string;
  position: string;
  minutes: number;
  injury: string;
  riskScore: number;
  riskTier: string;
  turnaroundDays: number;
  projection: string;
};

export type TournamentWorkload = {
  tournament: string;
  reportDate: string;
  /** First Gameweek the adjustment applies to. */
  firstGameweek: number;
  /** Gameweek after which fatigue is assumed to have washed out. */
  lastGameweek: number;
  records: WorkloadRecord[];
  /** Non-tournament injuries reported for the same round. */
  injuries: Array<{ player: string; club: string; issue: string; status: string }>;
};

type RawPlayer = {
  player: string; club: string; position: string; minutes: number;
  injury: string; risk_score: number; risk_tier: string;
  turnaround_days: number; projection: string;
};
type RawInjury = { player: string; club: string; issue: string; status: string };
type RawFile = {
  report_date: string;
  players: RawPlayer[];
  other_gw1_injuries: RawInjury[];
};

const raw = riskData as unknown as RawFile;

export const INTERNATIONAL_WORKLOAD: TournamentWorkload = {
  tournament: "FIFA World Cup 2026",
  reportDate: raw.report_date,
  firstGameweek: 1,
  lastGameweek: 4,
  records: raw.players.map((entry) => ({
    player: entry.player,
    club: entry.club,
    position: entry.position,
    minutes: entry.minutes,
    injury: entry.injury,
    riskScore: entry.risk_score,
    riskTier: entry.risk_tier,
    turnaroundDays: entry.turnaround_days,
    projection: entry.projection,
  })),
  injuries: raw.other_gw1_injuries.map((entry) => ({
    player: entry.player,
    club: entry.club,
    issue: entry.issue,
    status: entry.status,
  })),
};

/**
 * Availability implied by a reported medical status. Derived from the wording
 * the dataset uses, and applied as a ceiling on the chance of playing.
 */
function reportedAvailability(status: string): number | null {
  // Clauses are dropped when negated, so "surgery reportedly not expected"
  // does not read as surgery and "no confirmed injury" does not read as one.
  const asserted = status
    .toLowerCase()
    .split(/[;,]|\s+—\s+|\s+-\s+/)
    .filter((clause) => !/\bnot\b|\bno\b|\bwithout\b/.test(clause))
    .join(" ");

  if (/\bout\b|expected to miss|miss(ing)? gw1/.test(asserted)) return 0;
  if (/rehabilitation|surgery/.test(asserted)) return 0.12;
  if (/doubt/.test(asserted)) return 0.45;
  if (/monitor/.test(asserted)) return 0.8;
  return null;
}

/**
 * Fatigue-driven reduction in start probability, from the dataset's own
 * composite risk score. The score already folds in tournament stage, minutes
 * played and goalkeeping load, so nothing is recomputed here. Scores at or
 * below 3 are treated as no meaningful load, matching the dataset's LOW tier.
 */
const MAX_FATIGUE_REDUCTION = 0.34;

function fatigueReduction(riskScore: number) {
  return clamp((riskScore - 3) * 0.038, 0, MAX_FATIGUE_REDUCTION);
}

const DECAY_PER_GAMEWEEK = 0.5;
/** Minutes a returning starter is held back when they do start, at full impact. */
const PEAK_MINUTES_WITHHELD = 16;

export type WorkloadImpact = {
  player: string;
  /** Multiplier applied to the modelled start probability. */
  startProbabilityMultiplier: number;
  /** Hard ceiling on the chance of playing, from a reported medical status. */
  availabilityCeiling: number | null;
  minutesWithheld: number;
  confidence: number;
  reason: string;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalise(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z ]/g, "")
    .trim();
}

/** True when either club string identifies the other, tolerating short codes. */
function sameClub(datasetClub: string, candidates: string[]) {
  const target = normalise(datasetClub);
  return candidates.some((candidate) => {
    const value = normalise(candidate);
    if (!value) return false;
    return value === target || target.startsWith(value) || value.startsWith(target);
  });
}

/**
 * Matches a dataset row to an FPL player.
 *
 * Full name first, then surname. A surname is accepted on its own only when
 * exactly one row in the dataset carries it — otherwise the club must agree,
 * which is what separates the two Martinezes. FPL exposes clubs by short code
 * while the dataset uses full names, so both are offered to the comparison.
 */
function matchByName<T extends { player: string; club: string }>(
  rows: T[],
  fullName: string,
  webName: string,
  clubs: string[],
): T | null {
  const target = normalise(fullName);
  const short = normalise(webName);

  const exact = rows.find((row) => normalise(row.player) === target);
  if (exact) return exact;

  // Registered names carry extra components and nicknames that a reference
  // dataset omits: "Yeremy Pino" against "Yeremy Pino Santos", or "Rodri"
  // against "Rodrigo Rodri Hernandez Cascante". Accept the dataset name when
  // it appears as a run of whole words inside the registered name.
  const padded = ` ${target} `;
  const contained = rows.filter((row) => padded.includes(` ${normalise(row.player)} `));
  if (contained.length === 1) return contained[0];
  if (contained.length > 1) {
    return contained.find((row) => sameClub(row.club, clubs)) ?? null;
  }

  const surnameMatches = rows.filter((row) => {
    const name = normalise(row.player);
    return name === short || name.endsWith(` ${short}`) || target.endsWith(` ${name.split(" ").pop()}`);
  });
  if (surnameMatches.length === 1) return surnameMatches[0];
  if (surnameMatches.length > 1) {
    return surnameMatches.find((row) => sameClub(row.club, clubs)) ?? null;
  }
  return null;
}

export function findWorkloadRecord(
  workload: TournamentWorkload,
  fullName: string,
  webName: string,
  ...clubs: string[]
): WorkloadRecord | null {
  return matchByName(workload.records, fullName, webName, clubs);
}

export function findReportedInjury(
  workload: TournamentWorkload,
  fullName: string,
  webName: string,
  ...clubs: string[]
) {
  return matchByName(workload.injuries, fullName, webName, clubs);
}

/**
 * Returns the workload adjustment for a player in a given Gameweek, or null
 * when the player is not in the dataset or the effect has expired.
 */
export function workloadImpact(
  identity: { fullName: string; webName: string; club: string; clubName?: string } | null,
  gameweek: number,
  workload: TournamentWorkload = INTERNATIONAL_WORKLOAD,
): WorkloadImpact | null {
  if (!identity) return null;

  const clubs = [identity.clubName ?? "", identity.club].filter(Boolean);
  const record = findWorkloadRecord(workload, identity.fullName, identity.webName, ...clubs);
  const injury = findReportedInjury(workload, identity.fullName, identity.webName, ...clubs);
  if (!record && !injury) return null;

  // A reported medical status caps availability in every Gameweek covered, and
  // overrides fatigue rather than compounding with it.
  const ceilingSource = injury?.status ?? record?.injury ?? "";
  const availabilityCeiling = reportedAvailability(ceilingSource);

  const elapsed = gameweek - workload.firstGameweek;
  const withinFatigueWindow = gameweek >= workload.firstGameweek && gameweek <= workload.lastGameweek;
  const decay = DECAY_PER_GAMEWEEK ** Math.max(0, elapsed);
  const reduction = record && withinFatigueWindow && availabilityCeiling === null
    ? fatigueReduction(record.riskScore) * decay
    : 0;

  if (availabilityCeiling === null && reduction < 0.01) return null;

  const reasons: string[] = [];
  if (availabilityCeiling !== null) {
    reasons.push(
      `Reported status (${workload.reportDate}): ${(injury?.status ?? record?.injury ?? "").trim()}.`,
    );
  } else if (record) {
    reasons.push(
      `${workload.tournament} workload: ${record.minutes} tournament minutes, `
      + `${record.turnaroundDays}-day turnaround, ${record.riskTier} risk. `
      + `GW${gameweek} start probability reduced ${Math.round(reduction * 100)}%.`,
    );
  }

  return {
    player: record?.player ?? injury?.player ?? identity.webName,
    startProbabilityMultiplier: 1 - reduction,
    availabilityCeiling,
    // Scales with the load actually carried: a finalist who played six minutes
    // is not eased back in like one who played every knockout round.
    minutesWithheld: PEAK_MINUTES_WITHHELD * (reduction / MAX_FATIGUE_REDUCTION),
    confidence: record?.riskTier === "CRITICAL" || injury ? 0.75 : 0.6,
    reason: reasons.join(" "),
  };
}

/**
 * Applies a workload impact to an expected-minutes projection, preserving the
 * invariant that start, substitute and zero-minute probabilities sum to 100.
 * Probability removed by fatigue moves to a substitute appearance, since a
 * rested player is usually still named on the bench. Probability removed by a
 * medical ceiling moves to zero minutes instead.
 */
export function applyWorkload(
  projection: ExpectedMinutesProjection,
  impact: WorkloadImpact,
): ExpectedMinutesProjection {
  const originalStart = projection.startProbability / 100;
  const originalSubstitute = projection.substituteProbability / 100;
  if (originalStart <= 0 && originalSubstitute <= 0) return projection;

  let nextStart = clamp(originalStart * impact.startProbabilityMultiplier, 0, 0.98);
  let nextSubstitute = clamp(
    originalSubstitute + (originalStart - nextStart) * 0.75,
    0,
    1 - nextStart,
  );

  if (impact.availabilityCeiling !== null) {
    const ceiling = impact.availabilityCeiling;
    const playing = nextStart + nextSubstitute;
    if (playing > ceiling) {
      // Scale the whole playing mass down; the remainder becomes zero minutes.
      const scale = playing > 0 ? ceiling / playing : 0;
      nextStart *= scale;
      nextSubstitute *= scale;
    }
  }

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

export const WORKLOAD_MODEL_VERSION = "international-workload-v2";
