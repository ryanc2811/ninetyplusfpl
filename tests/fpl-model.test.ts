import assert from "node:assert/strict";
import test from "node:test";
import type { MatchForecastProjection, PlayerPointsProjection } from "../lib/contracts/fpl.ts";
import { projectExpectedMinutes, projectExpectedMinutesForSquad, projectPlayer, validateProjectionData, type FplElement, type FplFixture } from "../lib/fpl-model.ts";

function player(overrides: Partial<FplElement> = {}): FplElement {
  return {
    id: 1,
    web_name: "Test Forward",
    team: 1,
    element_type: 4,
    now_cost: 100,
    minutes: 2_900,
    starts: 34,
    chance_of_playing_next_round: null,
    ep_next: "5.5",
    form: "5.0",
    points_per_game: "5.8",
    total_points: 180,
    selected_by_percent: "20.0",
    transfers_in_event: 1_000,
    expected_goals_per_90: "0.6",
    expected_assists_per_90: "0.2",
    expected_goal_involvements_per_90: "0.8",
    clean_sheets_per_90: "0.2",
    defensive_contribution_per_90: "0",
    ...overrides,
  };
}

const fixtures: FplFixture[] = [
  { id: 1, event: 2, team_h: 1, team_a: 2, team_h_difficulty: 2, team_a_difficulty: 4, kickoff_time: "2026-08-22T14:00:00Z", finished: false },
  { id: 2, event: 3, team_h: 3, team_a: 1, team_h_difficulty: 4, team_a_difficulty: 2, kickoff_time: "2026-08-29T14:00:00Z", finished: false },
  { id: 3, event: 4, team_h: 1, team_a: 4, team_h_difficulty: 3, team_a_difficulty: 4, kickoff_time: "2026-09-12T14:00:00Z", finished: false },
];

test("expected-minutes probabilities are bounded and exhaustive", () => {
  const projection = projectExpectedMinutes(player(), 38);
  assert.equal(
    projection.startProbability + projection.substituteProbability + projection.zeroMinutesProbability,
    100,
  );
  assert.ok(projection.expectedMinutes >= 0 && projection.expectedMinutes <= 90);
  assert.ok(projection.startProbability > projection.substituteProbability);
  assert.equal(projection.modelVersion, "expected-minutes-baseline-v1");
});

test("official availability reduces minutes and increases zero-minute probability", () => {
  const fit = projectExpectedMinutes(player(), 38);
  const doubtful = projectExpectedMinutes(player({ chance_of_playing_next_round: 25 }), 38);
  assert.ok(doubtful.expectedMinutes < fit.expectedMinutes);
  assert.ok(doubtful.zeroMinutesProbability > fit.zeroMinutesProbability);
});

test("official injury status is respected when chance percentage is absent", () => {
  const injured = projectExpectedMinutes(
    player({ status: "i", chance_of_playing_next_round: null }),
    38,
  );
  assert.equal(injured.startProbability, 0);
  assert.equal(injured.expectedMinutes, 0);
  assert.equal(injured.zeroMinutesProbability, 100);
});

test("preseason projections retain reliability-weighted prior-season performance", () => {
  const gameweekOneFixtures: FplFixture[] = [
    {
      id: 100,
      event: 1,
      team_h: 1,
      team_a: 2,
      team_h_difficulty: 3,
      team_a_difficulty: 3,
      kickoff_time: "2026-08-15T14:00:00Z",
      finished: false,
    },
  ];
  const teams = new Map([[1, "AAA"], [2, "BBB"]]);
  const strongHistory = projectPlayer(
    player({ expected_goals_per_90: "0.75", expected_assists_per_90: "0.30", minutes: 2_900 }),
    gameweekOneFixtures,
    teams,
    1,
  );
  const weakHistory = projectPlayer(
    player({ expected_goals_per_90: "0.10", expected_assists_per_90: "0.05", minutes: 2_900 }),
    gameweekOneFixtures,
    teams,
    1,
  );

  assert.ok(strongHistory.xp1 > weakHistory.xp1 + 1.5);
});

test("a short minutes sample is shrunk toward the position prior", () => {
  const gameweekOneFixtures: FplFixture[] = [
    {
      id: 100,
      event: 1,
      team_h: 1,
      team_a: 2,
      team_h_difficulty: 3,
      team_a_difficulty: 3,
      kickoff_time: "2026-08-15T14:00:00Z",
      finished: false,
    },
  ];
  const teams = new Map([[1, "AAA"], [2, "BBB"]]);
  const hotStreak = { expected_goals_per_90: "1.20", expected_assists_per_90: "0.40" };
  const establishedSample = projectPlayer(
    player({ ...hotStreak, minutes: 2_900 }),
    gameweekOneFixtures,
    teams,
    1,
  );
  const thinSample = projectPlayer(
    player({ ...hotStreak, minutes: 180 }),
    gameweekOneFixtures,
    teams,
    1,
  );

  // The same headline rate must not carry the same weight off 180 minutes.
  assert.ok(thinSample.xp1 < establishedSample.xp1);
  assert.ok((thinSample.rates?.expectedGoals ?? 0) < (establishedSample.rates?.expectedGoals ?? 0));
});

test("points per game is not an input; underlying rates are", () => {
  const gameweekOneFixtures: FplFixture[] = [
    {
      id: 100,
      event: 1,
      team_h: 1,
      team_a: 2,
      team_h_difficulty: 3,
      team_a_difficulty: 3,
      kickoff_time: "2026-08-15T14:00:00Z",
      finished: false,
    },
  ];
  const teams = new Map([[1, "AAA"], [2, "BBB"]]);
  const high = projectPlayer(player({ points_per_game: "7.5" }), gameweekOneFixtures, teams, 1);
  const low = projectPlayer(player({ points_per_game: "1.0" }), gameweekOneFixtures, teams, 1);

  // Points per game is a consequence of the underlying rates, not independent
  // evidence, so holding those rates fixed must hold the projection fixed.
  assert.equal(high.xp1, low.xp1);
});

test("an unavailable starter transfers team opportunity to likely replacements", () => {
  const arsenal: FplElement[] = [
    player({
      id: 1,
      web_name: "Saliba",
      team: 1,
      element_type: 2,
      now_cost: 60,
      starts: 34,
      status: "i",
      chance_of_playing_next_round: 0,
    }),
    player({
      id: 2,
      web_name: "Mosquera",
      team: 1,
      element_type: 2,
      now_cost: 55,
      starts: 0,
      minutes: 0,
      status: "a",
    }),
    player({
      id: 3,
      web_name: "Calafiori",
      team: 1,
      element_type: 2,
      now_cost: 55,
      starts: 0,
      minutes: 0,
      status: "a",
    }),
    player({
      id: 4,
      web_name: "White",
      team: 1,
      element_type: 2,
      now_cost: 55,
      starts: 0,
      minutes: 0,
      status: "a",
    }),
  ];
  const independent = projectExpectedMinutes(arsenal[1], 38);
  const adjusted = projectExpectedMinutesForSquad(arsenal, 38);
  const mosquera = adjusted.get(2)!;
  const calafiori = adjusted.get(3)!;

  assert.ok(mosquera.startProbability > independent.startProbability + 30);
  assert.ok(mosquera.startProbability > calafiori.startProbability);
  assert.ok(mosquera.expectedMinutes > independent.expectedMinutes);
  assert.equal(
    mosquera.startProbability
      + mosquera.substituteProbability
      + mosquera.zeroMinutesProbability,
    100,
  );
  assert.equal(mosquera.modelVersion, "expected-minutes-team-opportunity-v1");
  assert.ok(mosquera.reasons.some((reason) => reason.includes("Saliba")));
});

test("a complete club roster is constrained to one legal probabilistic XI", () => {
  const rosterShape = [
    { position: 1, count: 2 },
    { position: 2, count: 7 },
    { position: 3, count: 8 },
    { position: 4, count: 4 },
  ];
  let id = 0;
  const squad = rosterShape.flatMap(({ position, count }) =>
    Array.from({ length: count }, (_, index) => {
      id += 1;
      return player({
        id,
        web_name: `Player ${id}`,
        team: 1,
        element_type: position,
        now_cost: 45 + (count - index) * 5,
        starts: Math.max(0, 34 - index * 6),
        minutes: Math.max(0, 2_800 - index * 420),
        selected_by_percent: String(Math.max(0, 30 - index * 4)),
        status: id === 3 ? "i" : "a",
        chance_of_playing_next_round: id === 3 ? 0 : null,
      });
    }),
  );

  const constrained = projectExpectedMinutesForSquad(squad, 38);
  const totalStartingProbability = [...constrained.values()].reduce(
    (sum, projection) => sum + projection.startProbability,
    0,
  );

  assert.ok(Math.abs(totalStartingProbability - 1_100) <= 6);
  assert.equal(constrained.get(3)?.startProbability, 0);
  assert.ok(
    [...constrained.values()].every(
      (projection) => projection.modelVersion === "expected-minutes-team-lineup-v1",
    ),
  );
  assert.ok(
    [...constrained.values()].some((projection) =>
      projection.reasons.some((reason) => reason.includes("Team lineup constraint:")),
    ),
  );

  const replayed = projectExpectedMinutesForSquad(squad, 38, constrained);
  assert.deepEqual(replayed, constrained);
});

test("player projections expose fixture and expected-minutes evidence", () => {
  const projection = projectPlayer(player(), fixtures, new Map([[1, "AAA"], [2, "BBB"], [3, "CCC"], [4, "DDD"]]), 2);
  assert.equal(projection.opponent, "BBB");
  assert.equal(projection.venue, "H");
  assert.equal(projection.fixtures.length, 3);
  assert.ok(projection.xp3 > projection.xp1);
  assert.equal(projection.expectedMinutes.reasons.length, 3);
});

test("player projection uses a stored v2 expected-minutes override", () => {
  const baseline = projectPlayer(
    player(),
    fixtures,
    new Map([[1, "AAA"], [2, "BBB"], [3, "CCC"], [4, "DDD"]]),
    2,
  );
  const adjusted = projectPlayer(
    player(),
    fixtures,
    new Map([[1, "AAA"], [2, "BBB"], [3, "CCC"], [4, "DDD"]]),
    2,
    {
      expectedMinutes: 18,
      startProbability: 10,
      substituteProbability: 50,
      zeroMinutesProbability: 40,
      sixtyMinuteProbability: 8,
      expectedMinutesIfStart: 70,
      expectedMinutesIfSubstitute: 22,
      earlySubstitutionProbability: 2,
      confidence: 44,
      reasons: ["stored temporal model"],
      modelVersion: "expected-minutes-v2-linear-1",
    },
  );
  assert.equal(adjusted.expectedMinutes.modelVersion, "expected-minutes-v2-linear-1");
  assert.ok(adjusted.xp1 < baseline.xp1);
});

test("player projection uses structural match probabilities when available", () => {
  const teams = new Map([[1, "AAA"], [2, "BBB"], [3, "CCC"], [4, "DDD"]]);
  const withoutMatchModel = projectPlayer(player(), fixtures, teams, 2);
  const matchForecast: MatchForecastProjection = {
    fixtureId: 1,
    homeTeam: "AAA",
    awayTeam: "BBB",
    expectedHomeGoals: 2.4,
    expectedAwayGoals: 0.7,
    homeWinProbability: 0.7,
    drawProbability: 0.2,
    awayWinProbability: 0.1,
    homeCleanSheetProbability: 0.5,
    awayCleanSheetProbability: 0.09,
    bothTeamsScoreProbability: 0.45,
    overTwoFiveProbability: 0.6,
    confidence: 0.8,
    modelVersion: "time-decayed-poisson-v1",
  };
  const withMatchModel = projectPlayer(
    player(),
    fixtures,
    teams,
    2,
    undefined,
    new Map([[1, matchForecast]]),
  );
  assert.equal(withMatchModel.teamExpectedGoals, 2.4);
  assert.equal(withMatchModel.cleanSheetProbability, 0.5);
  assert.ok(withMatchModel.xp1 > withoutMatchModel.xp1);
});

test("player projection uses stored Monte Carlo points and exposes uncertainty", () => {
  const distribution: PlayerPointsProjection = {
    fixtureId: 1,
    event: 2,
    expectedPoints: 7.4,
    medianPoints: 6,
    p10Points: 2,
    p90Points: 15,
    twoPlusProbability: 0.92,
    fivePlusProbability: 0.61,
    tenPlusProbability: 0.27,
    fifteenPlusProbability: 0.1,
    goalProbability: 0.48,
    assistProbability: 0.25,
    cleanSheetProbability: 0.08,
    bonusProbability: 0.34,
    defensiveContributionProbability: 0.04,
    expectedBonus: 0.7,
    expectedDefensiveContributionPoints: 0.08,
    confidence: 0.81,
    modelVersion: "correlated-player-points-monte-carlo-v1",
    rulesVersion: "fpl-2026-27-v1",
    simulationCount: 2000,
    eventModelVersion: "shrunk-player-position-poisson-v1",
    reasons: ["fixture-level simulation"],
  };
  const projection = projectPlayer(
    player(),
    fixtures,
    new Map([[1, "AAA"], [2, "BBB"], [3, "CCC"], [4, "DDD"]]),
    2,
    undefined,
    undefined,
    [distribution],
  );
  assert.equal(projection.xp1, 7.4);
  assert.equal(projection.pointsDistribution?.p90Points, 15);
  assert.equal(projection.pointsDistribution?.bonusProbability, 0.34);
});

test("data-quality validation fails closed on incomplete snapshots", () => {
  const projection = projectPlayer(player(), fixtures, new Map([[1, "AAA"], [2, "BBB"], [3, "CCC"], [4, "DDD"]]), 2);
  const quality = validateProjectionData([projection], fixtures);
  assert.equal(quality.valid, false);
  assert.ok(quality.issues.some((issue) => issue.includes("300 players")));
  assert.ok(quality.issues.some((issue) => issue.includes("20 teams")));
});
