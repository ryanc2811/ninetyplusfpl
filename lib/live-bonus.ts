import type { LivePlayerPoints } from "./contracts/live.ts";
import type { LiveFixture } from "./providers/live-provider.ts";

/**
 * Provisional bonus.
 *
 * The three bonus points in a match are decided by the bonus points system,
 * but the official feed only adds them to a player's total once the match is
 * confirmed — which can be hours after full time. Until then a score that
 * reads `total_points` alone is short by up to three points a player, which
 * on a Saturday evening is the difference between leading a month and not.
 *
 * So they are worked out here from the same BPS the game uses, and only for
 * matches that have started and have not had their bonus credited yet.
 */

const AWARDS = [3, 2, 1];

/**
 * Who gets what in one match.
 *
 * Ties share the higher award and push the next one down: two players level
 * at the top take three each and the next takes one, which is the game's own
 * rule rather than a simplification of it.
 */
export function bonusForFixture(players: Array<{ playerId: number; bps: number }>) {
  const contenders = players.filter((player) => player.bps > 0);
  const scores = [...new Set(contenders.map((player) => player.bps))]
    .sort((a, b) => b - a)
    .slice(0, AWARDS.length);

  const awarded = new Map<number, number>();
  let placed = 0;
  for (const score of scores) {
    const tied = contenders.filter((player) => player.bps === score);
    const award = AWARDS[placed] ?? 0;
    if (award > 0) {
      for (const player of tied) awarded.set(player.playerId, award);
    }
    placed += tied.length;
  }
  return awarded;
}

/**
 * Provisional bonus for every player in the Gameweek, keyed by player.
 *
 * A match whose bonus the feed has already credited is skipped: those points
 * are in `points` already and adding them again would inflate every manager
 * who owns one of the three.
 */
export function provisionalBonus(
  players: LivePlayerPoints[],
  fixtures: LiveFixture[],
): Map<number, number> {
  const started = new Set(fixtures.filter((fixture) => fixture.started).map((fixture) => fixture.id));
  const byFixture = new Map<number, Array<{ playerId: number; bps: number }>>();
  const credited = new Set<number>();

  for (const player of players) {
    for (const fixture of player.fixtures) {
      if (!started.has(fixture)) continue;
      if (player.bonus > 0) credited.add(fixture);
      const entry = byFixture.get(fixture) ?? [];
      entry.push({ playerId: player.playerId, bps: player.bps });
      byFixture.set(fixture, entry);
    }
  }

  const provisional = new Map<number, number>();
  for (const [fixture, entries] of byFixture) {
    if (credited.has(fixture)) continue;
    for (const [playerId, award] of bonusForFixture(entries)) {
      provisional.set(playerId, (provisional.get(playerId) ?? 0) + award);
    }
  }
  return provisional;
}
