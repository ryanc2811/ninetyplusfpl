import type {
  LiveManager,
  LivePlayerPoints,
  PlayerToPlay,
} from "./contracts/live.ts";
import type { MonthlyResult, MonthlyStanding } from "./contracts/leagues.ts";
import { assignRanks } from "./league-insights.ts";
import type { EntryPicks, LiveFixture, LivePlayerMeta } from "./providers/live-provider.ts";

/**
 * Live Gameweek maths.
 *
 * Everything here is pure: picks and live player points in, a manager's live
 * score and an updated month table out. The month totals a manager is judged
 * on have to be right while the Gameweek is still moving, which is exactly
 * when they are hardest to check by hand, so this is kept away from fetching.
 */

/**
 * The multiplier each pick is actually scoring on.
 *
 * Automatic substitutions and the vice-captain promotion are applied by the
 * official game at the end of a Gameweek, so during one the published picks
 * are what count; once they appear the feed has already made the swap and the
 * bench player is the one scoring.
 */
export function effectiveMultipliers(picks: EntryPicks): Map<number, number> {
  const multipliers = new Map(picks.picks.map((pick) => [pick.playerId, pick.multiplier]));
  for (const sub of picks.automaticSubs) {
    const out = multipliers.get(sub.out) ?? 0;
    multipliers.set(sub.out, 0);
    multipliers.set(sub.in, Math.max(out, 1));
  }
  return multipliers;
}

/** A manager's live score: picks against live points, net of this week's hits. */
export function liveEntryScore(
  picks: EntryPicks,
  liveByPlayer: Map<number, LivePlayerPoints>,
): { points: number; netPoints: number; transferCost: number } {
  const multipliers = effectiveMultipliers(picks);
  let points = 0;
  for (const [playerId, multiplier] of multipliers) {
    if (multiplier <= 0) continue;
    points += (liveByPlayer.get(playerId)?.points ?? 0) * multiplier;
  }
  return {
    points,
    netPoints: points - picks.transferCost,
    transferCost: picks.transferCost,
  };
}

/**
 * Whether a fixture can still produce points.
 *
 * The official feed keeps `finished` false until bonus is confirmed, which can
 * be the day after full time, so a match that has actually been played is
 * `finished_provisional`. Reading only `finished` would leave every manager
 * showing eleven players "still to play" for a day after the Gameweek.
 */
export function fixtureIsOver(fixture: LiveFixture) {
  return fixture.finished || fixture.finishedProvisional;
}

function fixtureLabel(fixture: LiveFixture, teamShort: Map<number, string>) {
  return `${teamShort.get(fixture.homeTeam) ?? "?"} v ${teamShort.get(fixture.awayTeam) ?? "?"}`;
}

/**
 * The starters whose fixture has not finished.
 *
 * A player with two fixtures in a double Gameweek still has points coming
 * while either of them is unplayed, so any unfinished fixture counts.
 */
export function playersStillToPlay(
  picks: EntryPicks,
  fixtures: LiveFixture[],
  meta: Map<number, LivePlayerMeta>,
  teamShort: Map<number, string>,
): PlayerToPlay[] {
  const multipliers = effectiveMultipliers(picks);
  const unfinishedByTeam = new Map<number, LiveFixture>();
  for (const fixture of fixtures) {
    if (fixtureIsOver(fixture)) continue;
    for (const team of [fixture.homeTeam, fixture.awayTeam]) {
      const existing = unfinishedByTeam.get(team);
      if (!existing || (fixture.kickoff ?? "") < (existing.kickoff ?? "")) {
        unfinishedByTeam.set(team, fixture);
      }
    }
  }

  const toPlay: PlayerToPlay[] = [];
  for (const pick of picks.picks) {
    if ((multipliers.get(pick.playerId) ?? 0) <= 0) continue;
    const player = meta.get(pick.playerId);
    if (!player) continue;
    const fixture = unfinishedByTeam.get(player.team);
    if (!fixture) continue;
    toPlay.push({
      playerId: pick.playerId,
      name: player.name,
      team: player.teamShort,
      fixture: fixtureLabel(fixture, teamShort),
      kickoff: fixture.kickoff,
      multiplier: multipliers.get(pick.playerId) ?? 1,
    });
  }
  return toPlay.sort((a, b) => b.multiplier - a.multiplier || a.name.localeCompare(b.name));
}

/** Everything the live endpoint reports for one manager. */
export function liveManager(
  picks: EntryPicks,
  liveByPlayer: Map<number, LivePlayerPoints>,
  fixtures: LiveFixture[],
  meta: Map<number, LivePlayerMeta>,
  teamShort: Map<number, string>,
): LiveManager {
  const score = liveEntryScore(picks, liveByPlayer);
  const multipliers = effectiveMultipliers(picks);
  const starters = picks.picks.filter((pick) => (multipliers.get(pick.playerId) ?? 0) > 0);
  const toPlay = playersStillToPlay(picks, fixtures, meta, teamShort);
  const toPlayIds = new Set(toPlay.map((player) => player.playerId));

  return {
    entryId: picks.entryId,
    ...score,
    playersPlayed: starters.filter(
      (pick) => !toPlayIds.has(pick.playerId) && (liveByPlayer.get(pick.playerId)?.played ?? false),
    ).length,
    playersToPlay: toPlay.length,
    toPlay,
    activeChip: picks.activeChip,
  };
}

/**
 * Folds the live Gameweek into a month table and re-ranks it.
 *
 * The official history publishes a Gameweek as soon as it is scored, so the
 * live Gameweek may already be in the table with provisional points: replace
 * it rather than adding it twice. When it is not there yet, the rank the feed
 * published *is* the standing before this Gameweek, which is what the movement
 * arrow must compare against.
 */
export function mergeLiveIntoMonth(
  result: MonthlyResult,
  liveByEntry: Map<number, { points: number; netPoints: number }>,
  event: number,
): MonthlyResult {
  const inWindow = event >= result.month.startEvent && event <= result.month.stopEvent;
  if (!inWindow || liveByEntry.size === 0) return result;

  const rows: MonthlyStanding[] = result.standings.map((row) => {
    const live = liveByEntry.get(row.entryId);
    if (!live) return { ...row };

    const existing = row.gameweeks.some((week) => week.event === event);
    const week = { event, points: live.points, netPoints: live.netPoints };
    const gameweeks = existing
      ? row.gameweeks.map((current) => (current.event === event ? week : current))
      : [...row.gameweeks, week].sort((a, b) => a.event - b.event);

    const grossPoints = gameweeks.reduce((sum, current) => sum + current.points, 0);
    const transferCost = gameweeks.reduce(
      (sum, current) => sum + (current.points - current.netPoints),
      0,
    );

    return {
      ...row,
      gameweeks,
      grossPoints,
      transferCost,
      netPoints: grossPoints - transferCost,
      gameweeksCounted: gameweeks.length,
      previousRank: existing ? row.previousRank : row.rank,
    };
  });

  for (const { row, rank } of assignRanks(rows)) row.rank = rank;
  return {
    month: result.month,
    standings: rows.sort((a, b) => a.rank - b.rank || a.teamName.localeCompare(b.teamName)),
  };
}
