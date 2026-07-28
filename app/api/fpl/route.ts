import { projectPlayer, type FplElement, type FplFixture, type Team } from "../../../lib/fpl-model";

type Bootstrap = {
  elements: FplElement[];
  teams: Team[];
  events: Array<{ id: number; is_next: boolean; finished: boolean }>;
};

export async function GET() {
  try {
    const [bootstrapResponse, fixturesResponse] = await Promise.all([
      fetch("https://fantasy.premierleague.com/api/bootstrap-static/", {
        headers: { Accept: "application/json", "User-Agent": "NinetyPlus/2.0" },
        next: { revalidate: 900 },
      }),
      fetch("https://fantasy.premierleague.com/api/fixtures/", {
        headers: { Accept: "application/json", "User-Agent": "NinetyPlus/2.0" },
        next: { revalidate: 900 },
      }),
    ]);

    if (!bootstrapResponse.ok || !fixturesResponse.ok) throw new Error("FPL feed unavailable");

    const [bootstrap, fixtures] = await Promise.all([
      bootstrapResponse.json() as Promise<Bootstrap>,
      fixturesResponse.json() as Promise<FplFixture[]>,
    ]);
    const teams = new Map(bootstrap.teams.map((team) => [team.id, team.short_name]));
    const nextEvent = bootstrap.events.find((event) => event.is_next)?.id ?? bootstrap.events.find((event) => !event.finished)?.id ?? 1;
    const players = bootstrap.elements
      .map((player) => projectPlayer(player, fixtures, teams, nextEvent))
      .sort((a, b) => b.xp3 - a.xp3);

    return Response.json({
      players,
      source: "official-fpl",
      model: {
        version: "fixture-blend-v2",
        horizon: 3,
        playerCount: players.length,
        features: ["official xP", "form", "points per game", "xG/xA", "minutes", "availability", "fixture difficulty", "venue"],
      },
      nextEvent,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    return Response.json({ error: "Live feed unavailable" }, { status: 503 });
  }
}
