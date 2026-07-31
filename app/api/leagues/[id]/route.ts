import type { LeagueInsightsResponse } from "../../../../lib/contracts/leagues";
import { awardBadges, managerInsights, monthlyResults } from "../../../../lib/league-insights";
import { OfficialFplLeagueProvider } from "../../../../lib/providers/league-provider";

/**
 * League insights.
 *
 * Building these costs one request per manager, so the analysed sample is
 * capped. Beyond the cap the league is reported as truncated rather than the
 * application issuing hundreds of requests against a public API.
 */
const DEFAULT_MAX_MANAGERS = 50;
const HARD_MAX_MANAGERS = 100;

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
    const provider = new OfficialFplLeagueProvider();
    const [standings, calendar] = await Promise.all([
      provider.loadStandings(leagueId, maxManagers),
      provider.loadCalendar(),
    ]);

    // Nothing has been scored yet, so skip the per-manager fetches entirely.
    const seasons = calendar.completedGameweeks > 0
      ? await provider.loadManagerSeasons(standings.entries)
      : standings.entries.map((entry) => ({
          entryId: entry.entryId,
          teamName: entry.teamName,
          managerName: entry.managerName,
          gameweeks: [],
        }));

    const months = monthlyResults(calendar.phases, calendar.events, seasons);
    const insights = managerInsights(seasons, months);

    const response: LeagueInsightsResponse = {
      league: {
        id: standings.id,
        name: standings.name,
        type: standings.type,
        entryCount: standings.entries.length,
        truncated: standings.truncated,
        analysedCount: seasons.length,
      },
      completedGameweeks: calendar.completedGameweeks,
      months,
      badges: awardBadges(months, insights),
      managers: insights.sort((a, b) => b.totalPoints - a.totalPoints),
      provenance: {
        source: "Fantasy Premier League public web data",
        retrievedAt: new Date().toISOString(),
        requestUrls: standings.requestUrls,
      },
    };

    return Response.json(response, {
      headers: {
        "Cache-Control": "public, max-age=600, s-maxage=1800, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "League lookup failed";
    const missing = message.includes("404");
    return Response.json(
      {
        error: missing ? "League not found" : "League lookup failed",
        detail: missing
          ? `No classic league exists with ID ${leagueId}, or it is private.`
          : "The official FPL feed did not respond.",
      },
      { status: missing ? 404 : 503 },
    );
  }
}
