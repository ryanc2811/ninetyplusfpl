import type { LeagueInsightsResponse, MonthlyResult } from "../../../lib/contracts/leagues";
import type { LiveManager } from "../../../lib/contracts/live";
import { winChance, type RemainingPlayer, type WinChanceManager } from "../../../lib/win-chance";
import type { Player } from "../../_state/app-state";

/**
 * Assembles what the month simulation needs from what the screen already has.
 *
 * Players still to play are valued with the projection model's own figures
 * for that player. Those are projected for the next deadline rather than the
 * fixture in progress, so they stand for how that player scores rather than
 * for this particular match — which is why the result is labelled an estimate
 * everywhere it appears.
 */
export function monthWinChance({
  result,
  liveByEntry,
  players,
  insights,
  event,
}: {
  result: MonthlyResult;
  liveByEntry: Map<number, LiveManager>;
  players: Player[];
  insights: LeagueInsightsResponse;
  event: number;
}): Map<number, number> | null {
  if (result.month.complete) return null;

  const playerById = new Map(players.map((player) => [player.id, player]));
  const insightByEntry = new Map(insights.managers.map((row) => [row.entryId, row]));
  const scoredGameweeks = Math.max(1, insights.completedGameweeks);
  // Gameweeks of the month that have not started at all.
  const futureGameweeks = Math.max(0, result.month.stopEvent - event);

  const managers: WinChanceManager[] = result.standings.map((row) => {
    const live = liveByEntry.get(row.entryId);
    const insight = insightByEntry.get(row.entryId);
    const remaining: RemainingPlayer[] = (live?.toPlay ?? []).map((pick) => {
      const player = playerById.get(pick.playerId);
      return {
        expected: player?.xp1 ?? 3,
        multiplier: pick.multiplier,
        p10: player?.pointsDistribution?.p10Points,
        median: player?.pointsDistribution?.medianPoints,
        p90: player?.pointsDistribution?.p90Points,
      };
    });

    return {
      entryId: row.entryId,
      points: row.netPoints,
      remaining,
      futureGameweeks,
      meanGameweek: insight ? insight.totalPoints / scoredGameweeks : 50,
      gameweekSd: insight?.consistency ?? 12,
    };
  });

  // Nothing left to sample means the month is already settled, and a bar
  // reading 100% tells a manager nothing they cannot see in the table.
  const anythingLeft = managers.some(
    (manager) => manager.remaining.length > 0 || manager.futureGameweeks > 0,
  );
  if (!anythingLeft) return null;

  return winChance(managers);
}

/** The bar's segments: the three likeliest, then everyone else together. */
export function winChanceSegments(
  chances: Map<number, number>,
  result: MonthlyResult,
  youEntryId: number | null,
) {
  const ranked = [...chances.entries()]
    .map(([entryId, chance]) => ({
      entryId,
      chance,
      name:
        entryId === youEntryId
          ? "You"
          : (result.standings.find((row) => row.entryId === entryId)?.managerName ?? "")
              .split(/\s+/)[0] || "Manager",
      you: entryId === youEntryId,
    }))
    .sort((a, b) => b.chance - a.chance);

  const top = ranked.slice(0, 3).filter((entry) => entry.chance > 0.005);
  const rest = 1 - top.reduce((total, entry) => total + entry.chance, 0);
  return rest > 0.005 ? [...top, { entryId: -1, chance: rest, name: "Others", you: false }] : top;
}

/** 41%, or <1% for a chance that is real but too small to round to one. */
export function formatChance(chance: number) {
  if (chance >= 0.995) return ">99%";
  if (chance > 0 && chance < 0.01) return "<1%";
  return `${Math.round(chance * 100)}%`;
}
