const POSITIONS: Record<number, "GK" | "DEF" | "MID" | "FWD"> = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };

export async function GET() {
  try {
    const response = await fetch("https://fantasy.premierleague.com/api/bootstrap-static/", {
      headers: { Accept: "application/json", "User-Agent": "NinetyPlus/1.0" },
      next: { revalidate: 900 },
    });
    if (!response.ok) throw new Error("FPL feed unavailable");
    const data = await response.json() as {
      elements: Array<Record<string, number | string | boolean>>;
      teams: Array<{ id: number; short_name: string }>;
    };
    const teams = new Map(data.teams.map((team) => [team.id, team.short_name]));
    const players = data.elements
      .filter((item) => Number(item.chance_of_playing_next_round ?? 100) > 0)
      .map((item) => {
        const expected = Number(item.ep_next || 0);
        const form = Number(item.form || 0);
        const pointsPerGame = Number(item.points_per_game || 0);
        const startProbability = Math.round(Math.min(98, Math.max(24, Number(item.minutes || 0) > 0 ? 72 + form * 3 : 48)));
        const xp1 = Math.max(expected, pointsPerGame * 0.62 + form * 0.38);
        return {
          id: Number(item.id),
          name: String(item.web_name),
          team: teams.get(Number(item.team)) || "—",
          opponent: "GW1",
          venue: "H",
          position: POSITIONS[Number(item.element_type)] || "MID",
          price: Number(item.now_cost) / 10,
          xp1: Number(xp1.toFixed(1)),
          xp3: Number((xp1 * 2.82).toFixed(1)),
          form,
          minutes: startProbability,
          ownership: Number(item.selected_by_percent || 0),
          risk: startProbability > 84 ? "Low" : startProbability > 66 ? "Medium" : "High",
          trend: Number((Number(item.transfers_in_event || 0) / Math.max(1, Number(item.selected_by_percent || 1) * 10000)).toFixed(1)),
        };
      })
      .sort((a, b) => b.xp3 - a.xp3)
      .slice(0, 80);
    return Response.json({ players, source: "official-fpl", updatedAt: new Date().toISOString() });
  } catch {
    return Response.json({ error: "Live feed unavailable" }, { status: 503 });
  }
}
