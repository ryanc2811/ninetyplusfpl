import type { Player } from "../../_state/app-state";
import type { SquadAsset } from "../../../lib/squad-builder";

/**
 * The range a squad's Gameweek is likely to land in.
 *
 * Summing each player's tenth and ninetieth percentile is deliberately rough:
 * it treats the eleven as independent, which overstates the width a little,
 * and it is only shown when the model actually publishes those percentiles.
 * A single projected figure with no spread reads as a promise, and it is not.
 */
export function likelyRange(
  starters: SquadAsset[],
  players: Player[],
  captainId: number | null,
): { low: number; high: number } | null {
  const byId = new Map(players.map((player) => [player.id, player]));
  let low = 0;
  let high = 0;
  let covered = 0;

  for (const starter of starters) {
    const distribution = byId.get(starter.id)?.pointsDistribution;
    if (!distribution) continue;
    const multiplier = starter.id === captainId ? 2 : 1;
    low += distribution.p10Points * multiplier;
    high += distribution.p90Points * multiplier;
    covered += 1;
  }

  // A range built from half an eleven would be quietly wrong.
  if (!starters.length || covered < starters.length) return null;
  return { low: Math.round(low), high: Math.round(high) };
}

/** Squad players the model does not expect to start. */
export function flaggedPlayers(squad: SquadAsset[], players: Player[]) {
  const byId = new Map(players.map((player) => [player.id, player]));
  return squad
    .map((asset) => ({ asset, player: byId.get(asset.id) }))
    .filter(({ player }) => {
      if (!player) return false;
      const start = player.expectedMinutes?.startProbability;
      return (start !== undefined && start < 75) || player.risk === "High";
    })
    .map(({ asset, player }) => ({
      name: asset.name,
      startProbability: player?.expectedMinutes?.startProbability ?? null,
      reason: player?.expectedMinutes?.reasons?.[0] ?? null,
    }));
}
