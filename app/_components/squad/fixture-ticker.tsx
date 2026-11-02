"use client";

import type { TeamOutlook } from "../../../lib/contracts/fpl";
import type { SquadAsset } from "../../../lib/squad-builder";
import { FdrChip } from "../ui";

/**
 * The run of fixtures your own players face.
 *
 * This is the one element in the system allowed to scroll sideways, because a
 * fixture run is a sequence and cutting it short hides the point of it.
 */
export function FixtureTicker({
  players,
  outlook,
  limit = 5,
}: {
  players: SquadAsset[];
  outlook: TeamOutlook[];
  limit?: number;
}) {
  const byTeam = new Map(outlook.map((team) => [team.team, team]));
  const rows = players
    .slice()
    .sort((a, b) => b.xp3 - a.xp3)
    .slice(0, limit)
    .map((player) => ({ player, fixtures: byTeam.get(player.team)?.fixtures ?? [] }))
    .filter((row) => row.fixtures.length > 0);

  if (!rows.length) return null;

  return (
    <div className="np-scroll-x -mx-4 flex gap-2 px-4 medium:mx-0 medium:px-0">
      {rows.map(({ player, fixtures }) => (
        <div
          key={player.id}
          className="flex min-w-[152px] flex-none flex-col gap-2 rounded-sm border border-border bg-surface p-3"
        >
          <span className="t-headline truncate">{player.name}</span>
          <div className="flex gap-1">
            {fixtures.slice(0, 3).map((fixture, index) => (
              <FdrChip
                key={`${fixture.opponent}-${index}`}
                opponent={fixture.opponent}
                venue={fixture.venue}
                difficulty={fixture.difficulty}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
