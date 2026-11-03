import { describeFplFailure, logFplFailure } from "../../../../../lib/providers/fpl-request";
import type { LeagueLiveResponse } from "../../../../../lib/contracts/live";
import { provisionalBonus } from "../../../../../lib/live-bonus";
import { liveManager } from "../../../../../lib/live-standings";
import { OfficialFplLeagueProvider } from "../../../../../lib/providers/league-provider";
import { OfficialFplLiveProvider } from "../../../../../lib/providers/live-provider";

/**
 * Live Gameweek scores for one league.
 *
 * The expensive part is picks, one request per manager, so they are cached far
 * longer than the client's poll interval: during a Gameweek picks only change
 * when the official game applies automatic substitutions at the end of it.
 * Everything else — the live points for every player in the game, the fixture
 * list, the player names — is a single shared request each.
 */
const DEFAULT_MAX_MANAGERS = Number(process.env.LEAGUE_MAX_MANAGERS) || 50;
const HARD_MAX_MANAGERS = 100;

export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const leagueId = Number(id);
  if (!Number.isInteger(leagueId) || leagueId <= 0) {
    return Response.json(
      { error: "Invalid league ID", detail: "Provide a positive integer league ID." },
      { status: 400 },
    );
  }

  const requested = Number(new URL(request.url).searchParams.get("limit"));
  const maxManagers = Number.isInteger(requested) && requested > 0
    ? Math.min(requested, HARD_MAX_MANAGERS)
    : DEFAULT_MAX_MANAGERS;

  try {
    const live = new OfficialFplLiveProvider();
    const status = await live.loadEventStatus();
    if (!status) {
      return Response.json(
        { error: "No Gameweek in progress", detail: "The season has not started." },
        { status: 404 },
      );
    }

    const leagues = new OfficialFplLeagueProvider();
    const [standings, points, fixtures, meta] = await Promise.all([
      leagues.loadStandings(leagueId, maxManagers),
      live.loadLivePoints(status.event),
      live.loadFixtures(status.event),
      live.loadPlayerMeta(),
    ]);

    const liveByPlayer = new Map(points.map((player) => [player.playerId, player]));
    const bonus = provisionalBonus(points, fixtures);
    const metaById = new Map(meta.map((player) => [player.playerId, player]));
    const teamShort = new Map(meta.map((player) => [player.team, player.teamShort]));

    const picks = await live.loadPicksFor(
      standings.entries.map((entry) => entry.entryId),
      status.event,
    );

    const response: LeagueLiveResponse = {
      event: status.event,
      started: status.started,
      finished: status.finished,
      dataChecked: status.dataChecked,
      retrievedAt: new Date().toISOString(),
      managers: picks.map((entry) =>
        liveManager(entry, {
          liveByPlayer,
          meta: metaById,
          fixtures,
          teamShort,
          provisionalBonus: bonus,
        }),
      ),
      provenance: {
        source: "Fantasy Premier League public web data",
        requestUrls: live.requestUrls.slice(0, 8),
      },
    };

    return Response.json(response, {
      headers: {
        // Short enough to stay live, long enough that several managers
        // watching the same league share one upstream round of requests.
        "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=120",
      },
    });
  } catch (error) {
    logFplFailure("leagues/[id]/live", error);
    const failure = describeFplFailure(error, "That league");
    return Response.json(failure.body, { status: failure.status });
  }
}
