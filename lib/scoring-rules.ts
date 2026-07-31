import type { Position } from "./contracts/fpl.ts";

/**
 * FPL scoring rules.
 *
 * The official bootstrap payload exposes `game_config.scoring`, so the per-event
 * point values are read from the live feed rather than hardcoded. Two rules are
 * not expressible in that payload and are held here as named constants:
 *
 * - saves score one point per three saves;
 * - goals conceded cost one point per two conceded.
 *
 * Defensive-contribution thresholds are also not in the payload. Defenders score
 * on ten `clearances_blocks_interceptions + tackles`; midfielders and forwards
 * score on twelve of those plus `recoveries`. Those definitions were confirmed
 * against the live feed: for every player the reported `defensive_contribution`
 * total reconstructs exactly from those component columns.
 */

export type PositionScores = Record<Position, number>;

export type ScoringRules = {
  version: string;
  source: "live-game-config" | "static-fallback";
  longPlay: number;
  shortPlay: number;
  longPlayMinutes: number;
  goals: PositionScores;
  assists: number;
  cleanSheets: PositionScores;
  goalsConceded: PositionScores;
  goalsConcededPer: number;
  saves: number;
  savesPer: number;
  defensiveContribution: PositionScores;
  defensiveContributionThreshold: PositionScores;
  yellowCards: number;
  redCards: number;
  ownGoals: number;
  penaltiesMissed: number;
  penaltiesSaved: number;
  bonus: number;
};

const STATIC_RULES: ScoringRules = {
  version: "fpl-2026-27-v1",
  source: "static-fallback",
  longPlay: 2,
  shortPlay: 1,
  longPlayMinutes: 60,
  goals: { GK: 10, DEF: 6, MID: 5, FWD: 4 },
  assists: 3,
  cleanSheets: { GK: 4, DEF: 4, MID: 1, FWD: 0 },
  goalsConceded: { GK: -1, DEF: -1, MID: 0, FWD: 0 },
  goalsConcededPer: 2,
  saves: 1,
  savesPer: 3,
  defensiveContribution: { GK: 0, DEF: 2, MID: 2, FWD: 2 },
  defensiveContributionThreshold: { GK: Infinity, DEF: 10, MID: 12, FWD: 12 },
  yellowCards: -1,
  redCards: -3,
  ownGoals: -2,
  penaltiesMissed: -2,
  penaltiesSaved: 5,
  bonus: 1,
};

/**
 * `game_config.scoring` keys positions as GKP/DEF/MID/FWD; the rest of the
 * application uses GK for goalkeepers.
 */
type RawPositionScores = Partial<Record<"GKP" | "DEF" | "MID" | "FWD", unknown>>;

export type RawScoringConfig = {
  long_play?: unknown;
  short_play?: unknown;
  goals_scored?: RawPositionScores;
  assists?: unknown;
  clean_sheets?: RawPositionScores;
  goals_conceded?: RawPositionScores;
  saves?: unknown;
  defensive_contribution?: RawPositionScores;
  yellow_cards?: unknown;
  red_cards?: unknown;
  own_goals?: unknown;
  penalties_missed?: unknown;
  penalties_saved?: unknown;
  bonus?: unknown;
};

function score(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positionScores(raw: RawPositionScores | undefined, fallback: PositionScores): PositionScores {
  if (!raw) return fallback;
  return {
    GK: score(raw.GKP, fallback.GK),
    DEF: score(raw.DEF, fallback.DEF),
    MID: score(raw.MID, fallback.MID),
    FWD: score(raw.FWD, fallback.FWD),
  };
}

/**
 * Reads scoring values from the live game configuration, falling back to the
 * published 2026/27 rules for any field the feed omits.
 */
export function resolveScoringRules(raw?: RawScoringConfig | null): ScoringRules {
  if (!raw) return STATIC_RULES;
  return {
    ...STATIC_RULES,
    source: "live-game-config",
    longPlay: score(raw.long_play, STATIC_RULES.longPlay),
    shortPlay: score(raw.short_play, STATIC_RULES.shortPlay),
    goals: positionScores(raw.goals_scored, STATIC_RULES.goals),
    assists: score(raw.assists, STATIC_RULES.assists),
    cleanSheets: positionScores(raw.clean_sheets, STATIC_RULES.cleanSheets),
    goalsConceded: positionScores(raw.goals_conceded, STATIC_RULES.goalsConceded),
    saves: score(raw.saves, STATIC_RULES.saves),
    defensiveContribution: positionScores(
      raw.defensive_contribution,
      STATIC_RULES.defensiveContribution,
    ),
    yellowCards: score(raw.yellow_cards, STATIC_RULES.yellowCards),
    redCards: score(raw.red_cards, STATIC_RULES.redCards),
    ownGoals: score(raw.own_goals, STATIC_RULES.ownGoals),
    penaltiesMissed: score(raw.penalties_missed, STATIC_RULES.penaltiesMissed),
    penaltiesSaved: score(raw.penalties_saved, STATIC_RULES.penaltiesSaved),
    bonus: score(raw.bonus, STATIC_RULES.bonus),
  };
}

export const FALLBACK_SCORING_RULES = STATIC_RULES;
