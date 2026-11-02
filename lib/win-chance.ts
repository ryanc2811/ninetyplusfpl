/**
 * Chance to win the month.
 *
 * The standings say who is ahead; this says who is likely to finish ahead,
 * which is a different question once you know how many players each manager
 * has left and who they are. It is a simulation, not a calculation: the month
 * is played out many times and each manager's share of the wins is reported.
 *
 * Two sources of uncertainty are sampled. Players still to play are drawn
 * from the projection model's own distribution for that player, so a captain
 * yet to kick off is worth more than a defender in the same position. Whole
 * Gameweeks still to come in the month are drawn from the manager's own
 * scoring record, because at that distance who they will own is unknowable.
 *
 * Everything here is pure and seeded, so the same inputs always give the same
 * numbers and a figure a manager reads twice does not move on its own.
 */

/** A player a manager has still to play, as the model sees them. */
export type RemainingPlayer = {
  /** Expected points for the fixture. */
  expected: number;
  /** 2 for a captain, 3 under Triple Captain. */
  multiplier: number;
  /** The model's own quantiles, when a trained distribution is available. */
  p10?: number;
  median?: number;
  p90?: number;
};

export type WinChanceManager = {
  entryId: number;
  /** Net points in the month so far, live Gameweek included. */
  points: number;
  remaining: RemainingPlayer[];
  /** Whole Gameweeks left in the month after the one being played. */
  futureGameweeks: number;
  /** The manager's own average net Gameweek score. */
  meanGameweek: number;
  /** The spread of their Gameweek scores; lower is steadier. */
  gameweekSd: number;
};

export const WIN_CHANCE_RUNS = 2000;

/** A small deterministic generator, so a reported chance never drifts. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller, for the Gameweek-level draws. */
function normal(random: () => number, mean: number, sd: number) {
  const u = Math.max(random(), Number.EPSILON);
  const v = random();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * One player's return for one fixture.
 *
 * With quantiles from the model the draw follows them directly, which keeps
 * the long right tail that makes a haul possible. Without them the spread is
 * widened around the expected value in proportion to it, because a forward on
 * eight expected points is far less predictable than a goalkeeper on three.
 */
export function samplePlayerPoints(random: () => number, player: RemainingPlayer) {
  const u = random();
  if (player.p10 !== undefined && player.median !== undefined && player.p90 !== undefined) {
    const { p10, median, p90 } = player;
    // Piecewise through the three quantiles, with the tails carried on at the
    // same slope rather than being clipped flat.
    let value: number;
    if (u <= 0.1) value = p10 - (0.1 - u) * (median - p10) * 2.5;
    else if (u <= 0.5) value = p10 + ((u - 0.1) / 0.4) * (median - p10);
    else if (u <= 0.9) value = median + ((u - 0.5) / 0.4) * (p90 - median);
    else value = p90 + (u - 0.9) * (p90 - median) * 2.5;
    return Math.round(value) * player.multiplier;
  }

  const mean = Math.max(0, player.expected);
  const sd = Math.max(1.5, 1.2 * Math.sqrt(mean + 1));
  return Math.max(-2, Math.round(normal(random, mean, sd))) * player.multiplier;
}

/**
 * Plays the rest of the month out many times and reports each manager's share
 * of the wins. Managers level at the top of a run share that win between them.
 */
export function winChance(
  managers: WinChanceManager[],
  runs = WIN_CHANCE_RUNS,
  seed = 20262027,
): Map<number, number> {
  const wins = new Map<number, number>(managers.map((manager) => [manager.entryId, 0]));
  if (!managers.length) return wins;

  const random = createRandom(seed);
  const totals = new Array<number>(managers.length);

  for (let run = 0; run < runs; run += 1) {
    let best = -Infinity;
    for (let index = 0; index < managers.length; index += 1) {
      const manager = managers[index];
      let total = manager.points;
      for (const player of manager.remaining) total += samplePlayerPoints(random, player);
      for (let week = 0; week < manager.futureGameweeks; week += 1) {
        total += Math.round(
          normal(random, manager.meanGameweek, Math.max(1, manager.gameweekSd)),
        );
      }
      totals[index] = total;
      if (total > best) best = total;
    }

    const leaders = [];
    for (let index = 0; index < managers.length; index += 1) {
      if (totals[index] === best) leaders.push(managers[index].entryId);
    }
    const share = 1 / leaders.length;
    for (const entryId of leaders) wins.set(entryId, (wins.get(entryId) ?? 0) + share);
  }

  const chances = new Map<number, number>();
  for (const [entryId, won] of wins) chances.set(entryId, won / runs);
  return chances;
}
