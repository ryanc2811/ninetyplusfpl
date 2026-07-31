import type { Position } from "./contracts/fpl.ts";
import {
  expectedBonusPer90,
  FALLBACK_CALIBRATION,
  type OutputCalibration,
} from "./calibration.ts";

/**
 * Per-90 rate estimation.
 *
 * The official feed publishes per-90 rates directly, but using them raw is
 * unsafe: a player with 90 minutes of football has the same headline xG/90 as a
 * player with 3,000, and pre-season those columns describe the *previous*
 * season under a different role. Every rate is therefore shrunk toward a
 * position-and-price prior in proportion to the minutes behind it:
 *
 *   shrunk = (observed * minutes + prior * PRIOR_MINUTES) / (minutes + PRIOR_MINUTES)
 *
 * PRIOR_MINUTES acts as a pseudo-count: at 810 minutes (nine full matches) an
 * observed rate carries half the weight, which is a conservative but stable
 * choice for a public-data model.
 */

const PRIOR_MINUTES = 810;

/**
 * Finishing skill — realised goals against expected goals — is only weakly
 * persistent, so a player's own ratio is shrunk hard toward the league
 * calibration. Assist conversion and bonus accumulation are more repeatable,
 * being driven by role and set-piece duty, so they shrink less.
 */
const FINISHING_PRIOR_MINUTES = 2400;
const ASSIST_CONVERSION_PRIOR_MINUTES = 1800;
const BONUS_PRIOR_MINUTES = 1200;

export type PlayerRates = {
  /** Non-penalty and penalty expected goals per 90 minutes. */
  expectedGoals: number;
  expectedAssists: number;
  /**
   * Realised-output rates per 90. These, not the expected metrics above, are
   * what the projection scores from: expected goals measure chance quality,
   * whereas FPL pays for goals, assists and bonus as they are actually awarded.
   */
  goals: number;
  assists: number;
  bonus: number;
  /** Raw defensive actions per 90, on the position's counting definition. */
  defensiveActions: number;
  saves: number;
  yellowCards: number;
  redCards: number;
  /** Team goals conceded per 90 while this player was on the pitch. */
  expectedGoalsConceded: number;
  /** Share of observed rate versus prior, 0 = pure prior, 1 = pure observation. */
  observationWeight: number;
  minutesObserved: number;
  notes: string[];
};

type RatePriors = {
  expectedGoals: { base: number; premium: number };
  expectedAssists: { base: number; premium: number };
  defensiveActions: number;
  saves: number;
  yellowCards: number;
  redCards: number;
};

/**
 * Priors are league-typical per-90 rates for a replacement-level player at the
 * position's floor price, and for an established premium at that position.
 */
const PRIORS: Record<Position, RatePriors> = {
  GK: {
    expectedGoals: { base: 0, premium: 0 },
    expectedAssists: { base: 0.005, premium: 0.01 },
    defensiveActions: 0,
    saves: 3.05,
    yellowCards: 0.05,
    redCards: 0.004,
  },
  DEF: {
    expectedGoals: { base: 0.04, premium: 0.13 },
    expectedAssists: { base: 0.04, premium: 0.14 },
    defensiveActions: 8.6,
    saves: 0,
    yellowCards: 0.15,
    redCards: 0.012,
  },
  MID: {
    expectedGoals: { base: 0.08, premium: 0.38 },
    expectedAssists: { base: 0.07, premium: 0.28 },
    defensiveActions: 7.1,
    saves: 0,
    yellowCards: 0.14,
    redCards: 0.008,
  },
  FWD: {
    expectedGoals: { base: 0.19, premium: 0.62 },
    expectedAssists: { base: 0.06, premium: 0.22 },
    defensiveActions: 3.2,
    saves: 0,
    yellowCards: 0.11,
    redCards: 0.006,
  },
};

const FLOOR_PRICE: Record<Position, number> = { GK: 4, DEF: 4, MID: 4.5, FWD: 4.5 };
/** Price above the positional floor at which the premium prior is reached. */
const PREMIUM_PRICE_SPAN: Record<Position, number> = { GK: 2.5, DEF: 3.5, MID: 6.5, FWD: 7 };

/** League-average team goals conceded per match, used as the xGC prior. */
export const LEAGUE_GOALS_PER_TEAM = 1.42;

function numeric(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function shrink(observed: number, prior: number, minutes: number) {
  return (observed * minutes + prior * PRIOR_MINUTES) / (minutes + PRIOR_MINUTES);
}

/** 0 at the positional floor price, 1 at established-premium price. */
export function priceSignal(price: number, position: Position) {
  return clamp((price - FLOOR_PRICE[position]) / PREMIUM_PRICE_SPAN[position], 0, 1);
}

function interpolate(range: { base: number; premium: number }, signal: number) {
  return range.base + (range.premium - range.base) * signal;
}

export type RateSource = {
  minutes: unknown;
  now_cost: unknown;
  expected_goals_per_90: unknown;
  expected_assists_per_90: unknown;
  defensive_contribution_per_90: unknown;
  saves_per_90: unknown;
  expected_goals_conceded_per_90: unknown;
  yellow_cards: unknown;
  red_cards: unknown;
  /** Realised season output, used to calibrate the expected metrics. */
  goals_scored?: unknown;
  assists?: unknown;
  bonus?: unknown;
  bps?: unknown;
  penalties_order?: unknown;
  corners_and_indirect_freekicks_order?: unknown;
  direct_freekicks_order?: unknown;
};

/**
 * Shrinks a realised rate toward a structurally-predicted prior. This is the
 * one principle behind goals, assists and bonus: the model never trusts a
 * player's raw output, and never ignores it either.
 */
function shrinkTowardPrior(
  observed: number,
  prior: number,
  minutes: number,
  priorMinutes: number,
) {
  return (observed * minutes + prior * priorMinutes) / (minutes + priorMinutes);
}

/**
 * Uplift applied to expected goals for the recognised first-choice penalty
 * taker. Historical xG already contains the penalties a player took last
 * season, so this is deliberately small: it represents the marginal value of
 * holding the duty now, not the full value of a penalty.
 */
const PENALTY_DUTY_EXPECTED_GOALS = 0.055;
const SET_PIECE_DUTY_EXPECTED_ASSISTS = 0.035;

export function estimatePlayerRates(
  player: RateSource,
  position: Position,
  calibration: OutputCalibration = FALLBACK_CALIBRATION,
): PlayerRates {
  const minutes = Math.max(0, numeric(player.minutes));
  const price = numeric(player.now_cost) / 10;
  const signal = priceSignal(price, position);
  const priors = PRIORS[position];
  const notes: string[] = [];

  const observationWeight = minutes / (minutes + PRIOR_MINUTES);

  const expectedGoalsPrior = interpolate(priors.expectedGoals, signal);
  const expectedAssistsPrior = interpolate(priors.expectedAssists, signal);

  let expectedGoals = shrink(
    numeric(player.expected_goals_per_90),
    expectedGoalsPrior,
    minutes,
  );
  let expectedAssists = shrink(
    numeric(player.expected_assists_per_90),
    expectedAssistsPrior,
    minutes,
  );

  if (numeric(player.penalties_order) === 1 && position !== "GK") {
    expectedGoals += PENALTY_DUTY_EXPECTED_GOALS;
    notes.push("First-choice penalty taker");
  }
  const takesCorners = numeric(player.corners_and_indirect_freekicks_order) === 1;
  const takesFreekicks = numeric(player.direct_freekicks_order) === 1;
  if ((takesCorners || takesFreekicks) && position !== "GK") {
    expectedAssists += SET_PIECE_DUTY_EXPECTED_ASSISTS;
    notes.push(takesCorners && takesFreekicks ? "Corners and direct free kicks" : takesCorners ? "First-choice corners" : "First-choice direct free kicks");
  }

  // Expected metrics describe chance quality. FPL pays for realised events, so
  // each expected rate becomes the *prior* for the matching realised rate and
  // the player's own output is shrunk toward it.
  const perNinetyRate = (total: unknown) =>
    minutes > 0 ? (numeric(total) * 90) / minutes : 0;

  const goals = shrinkTowardPrior(
    perNinetyRate(player.goals_scored),
    expectedGoals * calibration.goalsPerExpectedGoal,
    minutes,
    FINISHING_PRIOR_MINUTES,
  );
  const assists = shrinkTowardPrior(
    perNinetyRate(player.assists),
    expectedAssists * calibration.assistsPerExpectedAssist,
    minutes,
    ASSIST_CONVERSION_PRIOR_MINUTES,
  );

  // Bonus is a within-match rank statistic, so a player's BPS rate predicts it
  // structurally while their realised bonus carries the rest of the signal.
  const bpsPer90 = perNinetyRate(player.bps);
  const bonus = shrinkTowardPrior(
    perNinetyRate(player.bonus),
    expectedBonusPer90(calibration, bpsPer90),
    minutes,
    BONUS_PRIOR_MINUTES,
  );

  if (minutes >= 900 && expectedGoals > 0.15) {
    const finishing = goals / Math.max(0.0001, expectedGoals);
    if (finishing >= 1.12) notes.push(`Finishes above expectation (${finishing.toFixed(2)}x xG)`);
    else if (finishing <= 0.88) notes.push(`Finishes below expectation (${finishing.toFixed(2)}x xG)`);
  }

  const defensiveActions = shrink(
    numeric(player.defensive_contribution_per_90),
    priors.defensiveActions,
    minutes,
  );
  const saves = position === "GK"
    ? shrink(numeric(player.saves_per_90), priors.saves, minutes)
    : 0;
  const perNinety = (total: unknown) =>
    minutes > 0 ? (numeric(total) * 90) / minutes : 0;
  const yellowCards = shrink(perNinety(player.yellow_cards), priors.yellowCards, minutes);
  const redCards = shrink(perNinety(player.red_cards), priors.redCards, minutes);
  const expectedGoalsConceded = shrink(
    numeric(player.expected_goals_conceded_per_90),
    LEAGUE_GOALS_PER_TEAM,
    minutes,
  );

  if (minutes < 450) {
    notes.push(
      minutes === 0
        ? "No Premier League minutes on record; rates are prior-driven from position and price"
        : `Only ${Math.round(minutes)} minutes on record; rates shrunk heavily toward the position prior`,
    );
  }

  return {
    expectedGoals: Math.max(0, expectedGoals),
    expectedAssists: Math.max(0, expectedAssists),
    goals: Math.max(0, goals),
    assists: Math.max(0, assists),
    bonus: clamp(bonus, 0, 2.2),
    defensiveActions: Math.max(0, defensiveActions),
    saves: Math.max(0, saves),
    yellowCards: clamp(yellowCards, 0, 1),
    redCards: clamp(redCards, 0, 0.2),
    expectedGoalsConceded: clamp(expectedGoalsConceded, 0.35, 3.2),
    observationWeight: Number(observationWeight.toFixed(3)),
    minutesObserved: minutes,
    notes,
  };
}

export const RATE_MODEL_VERSION = "shrunk-per-90-rates-v1";
export { PRIOR_MINUTES };
