import type { ManagerLeaguesResponse } from "../../../lib/contracts/leagues";
import { OfficialFplLeagueProvider } from "../../../lib/providers/league-provider";

/**
 * Resolves a public FPL team ID to the manager and the classic leagues they
 * belong to. Only a team ID is accepted; this route never takes a credential.
 */
export async function GET(request: Request) {
  const entryParam = new URL(request.url).searchParams.get("entry");
  const entryId = Number(entryParam);
  if (!entryParam || !Number.isInteger(entryId) || entryId <= 0) {
    return Response.json(
      { error: "Invalid team ID", detail: "Provide a positive integer FPL team ID." },
      { status: 400 },
    );
  }

  try {
    const provider = new OfficialFplLeagueProvider();
    const { manager, leagues } = await provider.loadManagerLeagues(entryId);
    const response: ManagerLeaguesResponse = {
      manager,
      // Invitational leagues are the ones a manager actually chose to join, so
      // they lead; auto-joined system leagues follow.
      leagues: [
        ...leagues.filter((league) => league.type === "invitational"),
        ...leagues.filter((league) => league.type === "system"),
      ],
    };
    return Response.json(response, {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=1800",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Manager lookup failed";
    const missing = message.includes("404");
    return Response.json(
      {
        error: missing ? "Team not found" : "Manager lookup failed",
        detail: missing
          ? `No FPL team exists with ID ${entryId}.`
          : "The official FPL feed did not respond.",
      },
      { status: missing ? 404 : 503 },
    );
  }
}
