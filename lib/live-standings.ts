import type {
  AppliedSubstitution,
  LiveManager,
  LivePlayerPoints,
  PlayerToPlay,
} from "./contracts/live.ts";
import type { MonthlyResult, MonthlyStanding } from "./contracts/leagues.ts";
import { applyAutomaticSubs, type SubstitutionContext } from "./auto-subs.ts";
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

/** Everything a live score needs to know about the Gameweek being played. */
export type LiveContext = {
  liveByPlayer: Map<number, LivePlayerPoints>;
  meta: Map<number, LivePlayerMeta>;
  fixtures: LiveFixture[];
  teamShort: Map<number, string>;
  /**
   * Bonus the game has decided but not yet credited. Leaving it out makes
   * every score short on the evening of a match.
   */
  provisionalBonus?: Map<number, number>;
};

/** A player's live points including bonus that is settled but not yet credited. */
export function livePointsFor(playerId: number, context: LiveContext) {
  return (
    (context.liveByPlayer.get(playerId)?.points ?? 0)
    + (context.provisionalBonus?.get(playerId) ?? 0)
  );
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

/** The fixtures a player's club has left in this Gameweek, if any. */
function remainingFixtureFor(playerId: number, context: LiveContext) {
  const team = context.meta.get(playerId)?.team;
  if (team === undefined) return null;
  const theirs = context.fixtures.filter(
    (fixture) => fixture.homeTeam === team || fixture.awayTeam === team,
  );
  const pending = theirs.filter((fixture) => !fixtureIsOver(fixture));
  if (!pending.length) return null;
  // In a double Gameweek the next one to kick off is the one that matters.
  return [...pending].sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? ""))[0];
}

/** The view of the Gameweek that the substitution rules are applied against. */
export function substitutionContext(context: LiveContext): SubstitutionContext {
  return {
    position: (playerId) => context.meta.get(playerId)?.position ?? null,
    minutes: (playerId) => context.liveByPlayer.get(playerId)?.minutes ?? 0,
    fixtureIsOver: (playerId) => remainingFixtureFor(playerId, context) === null,
  };
}

/**
 * A manager's live score.
 *
 * Automatic substitutions are applied, so a starter who did not turn up is
 * replaced by the bench exactly as the game will replace them. Without that
 * the score is wrong for every manager with a blank in their eleven.
 */
export function liveEntryScore(picks: EntryPicks, context: LiveContext) {
  const subs = applyAutomaticSubs(picks, substitutionContext(context));
  let points = 0;
  for (const [playerId, multiplier] of subs.multipliers) {
    if (multiplier <= 0) continue;
    points += livePointsFor(playerId, context) * multiplier;
  }
  return {
    points,
    netPoints: points - picks.transferCost,
    transferCost: picks.transferCost,
    subs,
  };
}

function fixtureLabel(fixture: LiveFixture, teamShort: Map<number, string>) {
  return `${teamShort.get(fixture.homeTeam) ?? "?"} v ${teamShort.get(fixture.awayTeam) ?? "?"}`;
}

/**
 * The players in the scoring eleven whose fixture has not finished.
 *
 * It reads the eleven after substitutions, because a starter the bench has
 * already replaced has nothing left to give.
 */
export function playersStillToPlay(picks: EntryPicks, context: LiveContext): PlayerToPlay[] {
  const { multipliers } = applyAutomaticSubs(picks, substitutionContext(context));
  const toPlay: PlayerToPlay[] = [];

  for (const pick of picks.picks) {
    const multiplier = multipliers.get(pick.playerId) ?? 0;
    if (multiplier <= 0) continue;
    const player = context.meta.get(pick.playerId);
    const fixture = remainingFixtureFor(pick.playerId, context);
    if (!player || !fixture) continue;
    toPlay.push({
      playerId: pick.playerId,
      name: player.name,
      team: player.teamShort,
      fixture: fixtureLabel(fixture, context.teamShort),
      kickoff: fixture.kickoff,
      multiplier,
    });
  }
  return toPlay.sort((a, b) => b.multiplier - a.multiplier || a.name.localeCompare(b.name));
}

/** Everything the live endpoint reports for one manager. */
export function liveManager(picks: EntryPicks, context: LiveContext): LiveManager {
  const score = liveEntryScore(picks, context);
  const toPlay = playersStillToPlay(picks, context);
  const toPlayIds = new Set(toPlay.map((player) => player.playerId));
  const scoring = [...score.subs.multipliers.entries()].filter(([, multiplier]) => multiplier > 0);
  const name = (playerId: number) => context.meta.get(playerId)?.name ?? `Player ${playerId}`;

  const substitutions: AppliedSubstitution[] = score.subs.substitutions.map((sub) => ({
    out: name(sub.out),
    in: name(sub.in),
    official: score.subs.official,
  }));

  return {
    entryId: picks.entryId,
    points: score.points,
    netPoints: score.netPoints,
    transferCost: score.transferCost,
    playersPlayed: scoring.filter(
      ([playerId]) =>
        !toPlayIds.has(playerId) && (context.liveByPlayer.get(playerId)?.played ?? false),
    ).length,
    playersToPlay: toPlay.length,
    toPlay,
    activeChip: picks.activeChip,
    substitutions,
    captainMoved: score.subs.captainMoved,
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
