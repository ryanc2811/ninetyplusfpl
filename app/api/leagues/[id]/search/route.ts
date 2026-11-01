import { OfficialFplLeagueProvider } from "../../../../../lib/providers/league-provider";

/**
 * Finds a team inside a league by name.
 *
 * The official API has no global team search — a team ID is the only public
 * handle on a manager — so the nearest honest thing is to search a league a
 * manager already knows they are in. That is enough to recover your own ID
 * without hunting through the FPL site for it.
 */
export type LeagueSearchResponse = {
  league: { id: number; name: string };
  query: string;
  scanned: number;
  /** True when the league is bigger than the pages this search reads. */
  truncated: boolean;
  matches: Array<{
    entryId: number;
    teamName: string;
    managerName: string;
    rank: number;
    total: number;
  }>;
};

export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const leagueId = Number(id);
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim();

  if (!Number.isInteger(leagueId) || leagueId <= 0) {
    return Response.json(
      { error: "Invalid league ID", detail: "Provide a positive integer league ID." },
      { status: 400 },
    );
  }
  if (query.length < 2) {
    return Response.json(
      { error: "Search too short", detail: "Type at least two characters of the name." },
      { status: 400 },
    );
  }

  try {
    const provider = new OfficialFplLeagueProvider();
    const result = await provider.searchEntries(leagueId, query);
    const response: LeagueSearchResponse = {
      league: { id: leagueId, name: result.name },
      query,
      scanned: result.scanned,
      truncated: result.truncated,
      matches: result.matches.map((entry) => ({
        entryId: entry.entryId,
        teamName: entry.teamName,
        managerName: entry.managerName,
        rank: entry.rank,
        total: entry.total,
      })),
    };
    return Response.json(response, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=900" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed";
    const missing = message.includes("404");
    return Response.json(
      {
        error: missing ? "League not found" : "Search failed",
        detail: missing
          ? `No classic league exists with ID ${leagueId}, or it is private.`
          : "The official FPL feed did not respond.",
      },
      { status: missing ? 404 : 503 },
    );
  }
}
