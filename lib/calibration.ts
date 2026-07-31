/**
 * Output calibration.
 *
 * The model was projecting from *expected* metrics (xG, xA) and an invented
 * BPS-to-bonus curve. Measured against the league's own realised output, both
 * were biased in the same direction:
 *
 * - FPL awards assists more generously than xA models them, so xA
 *   systematically understates realised assists.
 * - The hand-written bonus curve was several times too low across its whole
 *   range.
 *
 * Both biases grow with player quality, which is why the gap to established
 * competitors widened at the top of the ranking rather than being a constant
 * offset.
 *
 * The fix is not new constants. It is to fit the mapping from underlying rate
 * to realised output from the snapshot itself, every time a snapshot is
 * loaded, so the calibration tracks the league instead of a guess made once.
 */

export type BonusKnot = { bpsPer90: number; bonusPer90: number };

export type OutputCalibration = {
  version: string;
  source: "fitted-from-snapshot" | "static-fallback";
  /** Realised goals per unit of expected goals, pooled across the league. */
  goalsPerExpectedGoal: number;
  /** Realised assists per unit of expected assists, pooled across the league. */
  assistsPerExpectedAssist: number;
  /** Monotone piecewise-linear map from BPS per 90 to bonus per 90. */
  bonusKnots: BonusKnot[];
  sampleSize: number;
};

/**
 * Used before a snapshot is available. These are the values the current feed
 * fits to, kept only so the model degrades to something sane rather than to
 * raw expected metrics.
 */
export const FALLBACK_CALIBRATION: OutputCalibration = {
  version: "output-calibration-v1",
  source: "static-fallback",
  goalsPerExpectedGoal: 1.0,
  assistsPerExpectedAssist: 1.3,
  bonusKnots: [
    { bpsPer90: 0, bonusPer90: 0 },
    { bpsPer90: 12.5, bonusPer90: 0.19 },
    { bpsPer90: 17.5, bonusPer90: 0.3 },
    { bpsPer90: 22.5, bonusPer90: 0.55 },
    { bpsPer90: 27.5, bonusPer90: 0.96 },
    { bpsPer90: 35, bonusPer90: 1.5 },
  ],
  sampleSize: 0,
};

/** Minutes a player needs before their season rates are stable enough to fit. */
const FIT_MINUTES_THRESHOLD = 900;
const BONUS_BIN_WIDTH = 5;
const MAX_BONUS_PER_90 = 2.2;

export type CalibrationSource = {
  minutes: unknown;
  goals_scored: unknown;
  assists: unknown;
  expected_goals: unknown;
  expected_assists: unknown;
  bps: unknown;
  bonus: unknown;
};

function numeric(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Fits the calibration from a snapshot. Ratios are pooled rather than averaged
 * per player, so a low-minute player with a freak ratio cannot move the league
 * estimate.
 */
export function fitOutputCalibration(players: CalibrationSource[]): OutputCalibration {
  const qualifying = players.filter(
    (player) => numeric(player.minutes) >= FIT_MINUTES_THRESHOLD,
  );
  if (qualifying.length < 30) return FALLBACK_CALIBRATION;

  const sum = (pick: (player: CalibrationSource) => number) =>
    qualifying.reduce((total, player) => total + pick(player), 0);

  const totalGoals = sum((player) => numeric(player.goals_scored));
  const totalExpectedGoals = sum((player) => numeric(player.expected_goals));
  const totalAssists = sum((player) => numeric(player.assists));
  const totalExpectedAssists = sum((player) => numeric(player.expected_assists));

  // Bin by BPS per 90 and take the mean realised bonus per 90 in each bin.
  const bins = new Map<number, { bonus: number; count: number }>();
  for (const player of qualifying) {
    const minutes = numeric(player.minutes);
    const bpsPer90 = (numeric(player.bps) * 90) / minutes;
    const bonusPer90 = (numeric(player.bonus) * 90) / minutes;
    const bin = Math.floor(bpsPer90 / BONUS_BIN_WIDTH);
    const entry = bins.get(bin) ?? { bonus: 0, count: 0 };
    entry.bonus += bonusPer90;
    entry.count += 1;
    bins.set(bin, entry);
  }

  const knots: BonusKnot[] = [{ bpsPer90: 0, bonusPer90: 0 }];
  let highest = 0;
  for (const bin of [...bins.keys()].sort((a, b) => a - b)) {
    const entry = bins.get(bin)!;
    // Thin bins at the extremes are noise, not signal.
    if (entry.count < 3) continue;
    // Bonus rises with BPS, so enforce monotonicity rather than trusting a
    // sparse bin that dips.
    highest = Math.max(highest, entry.bonus / entry.count);
    knots.push({
      bpsPer90: (bin + 0.5) * BONUS_BIN_WIDTH,
      bonusPer90: Number(highest.toFixed(3)),
    });
  }

  if (knots.length < 3) return FALLBACK_CALIBRATION;

  return {
    version: "output-calibration-v1",
    source: "fitted-from-snapshot",
    goalsPerExpectedGoal: totalExpectedGoals > 0
      ? clamp(totalGoals / totalExpectedGoals, 0.75, 1.35)
      : FALLBACK_CALIBRATION.goalsPerExpectedGoal,
    assistsPerExpectedAssist: totalExpectedAssists > 0
      ? clamp(totalAssists / totalExpectedAssists, 0.75, 2.2)
      : FALLBACK_CALIBRATION.assistsPerExpectedAssist,
    bonusKnots: knots,
    sampleSize: qualifying.length,
  };
}

/**
 * Linear interpolation between fitted knots. Beyond the top knot the last
 * gradient continues, capped, so an exceptional BPS rate is not flattened to
 * the highest observed bin.
 */
export function expectedBonusPer90(
  calibration: OutputCalibration,
  bpsPer90: number,
): number {
  const knots = calibration.bonusKnots;
  if (!knots.length) return 0;
  if (bpsPer90 <= knots[0].bpsPer90) return knots[0].bonusPer90;

  for (let index = 1; index < knots.length; index += 1) {
    const previous = knots[index - 1];
    const current = knots[index];
    if (bpsPer90 <= current.bpsPer90) {
      const span = current.bpsPer90 - previous.bpsPer90;
      if (span <= 0) return current.bonusPer90;
      const position = (bpsPer90 - previous.bpsPer90) / span;
      return previous.bonusPer90 + (current.bonusPer90 - previous.bonusPer90) * position;
    }
  }

  const last = knots[knots.length - 1];
  const previous = knots[knots.length - 2] ?? { bpsPer90: 0, bonusPer90: 0 };
  const span = last.bpsPer90 - previous.bpsPer90;
  const gradient = span > 0 ? (last.bonusPer90 - previous.bonusPer90) / span : 0;
  return clamp(
    last.bonusPer90 + gradient * (bpsPer90 - last.bpsPer90),
    0,
    MAX_BONUS_PER_90,
  );
}

export const CALIBRATION_MODEL_VERSION = "output-calibration-v1";
