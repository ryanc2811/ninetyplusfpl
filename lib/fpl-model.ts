export type Position = "GK" | "DEF" | "MID" | "FWD";
export type FplElement = Record<string, number | string | boolean | null>;

export type FplFixture = {
  event: number | null;
  team_h: number;
  team_a: number;
  team_h_difficulty: number;
  team_a_difficulty: number;
  kickoff_time: string | null;
  finished: boolean;
};

export type Team = { id: number; short_name: string };

type FixtureContext = {
  opponent: string;
  venue: "H" | "A";
  difficulty: number;
  event: number;
};

const POSITION_BY_ID: Record<number, Position> = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };
const POSITION_PRIOR: Record<Position, number> = { GK: 2.7, DEF: 2.8, MID: 3.2, FWD: 3 };
const POSITION_FLOOR_PRICE: Record<Position, number> = { GK: 4, DEF: 4, MID: 4.5, FWD: 4.5 };
const FIXTURE_MULTIPLIER: Record<number, number> = { 1: 1.22, 2: 1.11, 3: 1, 4: 0.89, 5: 0.78 };

function numeric(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number) {
  return Number(value.toFixed(1));
}

function fixturesForTeam(teamId: number, fixtures: FplFixture[], teams: Map<number, string>, nextEvent: number) {
  return fixtures
    .filter((fixture) => !fixture.finished && fixture.event !== null && fixture.event >= nextEvent)
    .filter((fixture) => fixture.team_h === teamId || fixture.team_a === teamId)
    .sort((a, b) => numeric(a.event) - numeric(b.event))
    .slice(0, 3)
    .map<FixtureContext>((fixture) => {
      const home = fixture.team_h === teamId;
      const opponentId = home ? fixture.team_a : fixture.team_h;
      return {
        opponent: teams.get(opponentId) || "TBC",
        venue: home ? "H" : "A",
        difficulty: home ? fixture.team_h_difficulty : fixture.team_a_difficulty,
        event: numeric(fixture.event),
      };
    });
}

function estimateStartProbability(player: FplElement) {
  const minutes = numeric(player.minutes);
  const starts = numeric(player.starts);
  const appearances = Math.max(starts, numeric(player.appearances), 1);
  const availability = player.chance_of_playing_next_round === null ? 100 : numeric(player.chance_of_playing_next_round, 100);
  const minutesPerStart = starts > 0 ? minutes / starts : minutes > 0 ? 62 : 0;
  const roleSecurity = starts > 0 ? clamp(starts / appearances, 0.35, 1) : minutes > 0 ? 0.62 : 0.25;
  const probability = (0.48 * roleSecurity + 0.32 * clamp(minutesPerStart / 90, 0, 1) + 0.2) * availability;
  return Math.round(clamp(probability, 12, 98));
}

function baselinePoints(player: FplElement, position: Position, preseason: boolean) {
  const officialExpected = numeric(player.ep_next);
  const form = numeric(player.form);
  const pointsPerGame = numeric(player.points_per_game);
  const expectedGoals = numeric(player.expected_goals_per_90);
  const expectedAssists = numeric(player.expected_assists_per_90);
  const expectedGoalInvolvements = numeric(player.expected_goal_involvements_per_90);
  const attackingSignal = Math.max(expectedGoals + expectedAssists, expectedGoalInvolvements);
  const cleanSheetSignal = numeric(player.clean_sheets_per_90);
  const defensiveSignal = numeric(player.defensive_contribution_per_90);
  const price = numeric(player.now_cost) / 10;
  const pricePrior = POSITION_PRIOR[position] + Math.max(0, price - POSITION_FLOOR_PRICE[position]) * 0.35;
  const positionSignal =
    position === "GK" ? cleanSheetSignal * 1.3 :
    position === "DEF" ? cleanSheetSignal * 1.2 + attackingSignal * 1.1 :
    position === "MID" ? attackingSignal * 1.8 + defensiveSignal * 0.08 :
    attackingSignal * 2.1;
  const hasObservedSeasonData = !preseason && numeric(player.total_points) > 0 && (pointsPerGame > 0 || form > 0);
  const observed = hasObservedSeasonData
    ? pointsPerGame * 0.42 + form * 0.32 + positionSignal * 0.26
    : pricePrior;
  if (officialExpected > 0) {
    const officialSignal = hasObservedSeasonData ? officialExpected : Math.max(officialExpected, pricePrior * 0.75);
    return officialSignal * 0.5 + observed * 0.35 + pricePrior * 0.15;
  }
  return hasObservedSeasonData ? observed * 0.7 + pricePrior * 0.3 : pricePrior;
}

function confidenceScore(player: FplElement, fixtureCount: number, startProbability: number) {
  const sampleScore = clamp(numeric(player.minutes) / 900, 0, 1) * 28;
  const roleScore = (startProbability / 100) * 34;
  const fixtureScore = (fixtureCount / 3) * 24;
  const newsScore = player.chance_of_playing_next_round !== null ? 14 : 8;
  return Math.round(clamp(sampleScore + roleScore + fixtureScore + newsScore, 22, 96));
}

export function projectPlayer(player: FplElement, fixtures: FplFixture[], teams: Map<number, string>, nextEvent: number) {
  const position = POSITION_BY_ID[numeric(player.element_type)] || "MID";
  const teamId = numeric(player.team);
  const upcoming = fixturesForTeam(teamId, fixtures, teams, nextEvent);
  const startProbability = estimateStartProbability(player);
  const baseline = baselinePoints(player, position, nextEvent === 1);
  const roleFactor = 0.52 + (startProbability / 100) * 0.48;
  const fixturePoints = upcoming.map((fixture, index) => {
    const difficultyFactor = FIXTURE_MULTIPLIER[fixture.difficulty] ?? 1;
    const homeFactor = fixture.venue === "H" ? 1.035 : 0.965;
    const horizonDiscount = 1 - index * 0.025;
    return round(clamp(baseline * roleFactor * difficultyFactor * homeFactor * horizonDiscount, 0.2, 14));
  });
  const fallback = round(clamp(baseline * roleFactor, 0.2, 12));
  const xp1 = fixturePoints[0] ?? fallback;
  const xp3 = round(fixturePoints.length ? fixturePoints.reduce((sum, score) => sum + score, 0) : fallback * 2.75);
  const firstFixture = upcoming[0];
  const confidence = confidenceScore(player, upcoming.length, startProbability);
  const availability = player.chance_of_playing_next_round === null ? 100 : numeric(player.chance_of_playing_next_round, 100);

  return {
    id: numeric(player.id),
    name: String(player.web_name),
    team: teams.get(teamId) || "—",
    opponent: firstFixture?.opponent || "TBC",
    venue: firstFixture?.venue || ("H" as const),
    position,
    price: numeric(player.now_cost) / 10,
    xp1,
    xp3,
    form: numeric(player.form),
    minutes: startProbability,
    ownership: numeric(player.selected_by_percent),
    risk: availability < 75 || startProbability < 58 ? "High" : startProbability < 78 ? "Medium" : "Low",
    trend: round(numeric(player.transfers_in_event) / Math.max(1, numeric(player.selected_by_percent, 1) * 10000)),
    confidence,
    fixtures: upcoming.map((fixture) => `${fixture.opponent} (${fixture.venue})`),
    breakdown: fixturePoints,
  };
}
