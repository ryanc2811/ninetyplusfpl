import { describeFplFailure, logFplFailure } from "../../../../../lib/providers/fpl-request";
import type { EntrySquadResponse } from "../../../../../lib/contracts/live";
import { OfficialFplLeagueProvider } from "../../../../../lib/providers/league-provider";
import { OfficialFplLiveProvider } from "../../../../../lib/providers/live-provider";

/**
 * A manager's real squad.
 *
 * Only the picks are returned, not projections: the client already holds the
 * projected player market, so sending ids keeps the two from disagreeing about
 * what a player is worth.
 */
export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const entryId = Number(id);
  if (!Number.isInteger(entryId) || entryId <= 0) {
    return Response.json(
      { error: "Invalid team ID", detail: "Provide a positive integer team ID." },
      { status: 400 },
    );
  }

  try {
    const live = new OfficialFplLiveProvider();
    const status = await live.loadEventStatus();
    if (!status) {
      return Response.json(
        { error: "No squad yet", detail: "The season has not started." },
        { status: 404 },
      );
    }

    const leagues = new OfficialFplLeagueProvider();
    const [picks, manager] = await Promise.all([
      live.loadPicks(entryId, status.event),
      leagues.loadManager(entryId),
    ]);

    if (!picks) {
      return Response.json(
        {
          error: "Squad unavailable",
          detail: `This team has no squad published for Gameweek ${status.event}.`,
        },
        { status: 404 },
      );
    }

    const response: EntrySquadResponse = {
      entryId,
      teamName: manager.teamName,
      managerName: manager.managerName,
      event: status.event,
      finished: status.finished,
      activeChip: picks.activeChip,
      bank: picks.bank,
      squadValue: picks.squadValue,
      picks: picks.picks,
    };

    return Response.json(response, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=900" },
    });
  } catch (error) {
    logFplFailure("entry/[id]/squad", error);
    const failure = describeFplFailure(error, "That team");
    return Response.json(failure.body, { status: failure.status });
  }
}
