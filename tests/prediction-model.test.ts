import assert from "node:assert/strict";
import test from "node:test";
import { FALLBACK_SCORING_RULES, resolveScoringRules } from "../lib/scoring-rules.ts";
import { estimatePlayerRates, LEAGUE_GOALS_PER_TEAM, type RateSource } from "../lib/player-rates.ts";
import { buildTeamStrengths, expectFixture, type SquadMember } from "../lib/team-strength.ts";
import { applyWorkload, workloadImpact, type TournamentWorkload } from "../lib/workload.ts";
import { buildProjectionContext, projectPlayer, type FplElement, type FplFixture } from "../lib/fpl-model.ts";

function rateSource(overrides: Partial<RateSource> = {}): RateSource {
  return {
    minutes: 2_700,
    now_cost: 70,
    expected_goals_per_90: "0.3",
    expected_assists_per_90: "0.2",
    defensive_contribution_per_90: "8",
    saves_per_90: "0",
    expected_goals_conceded_per_90: "1.3",
    yellow_cards: 5,
    red_cards: 0,
    ...overrides,
  };
}

// --- scoring rules -------------------------------------------------------

test("scoring rules are read from the live game configuration", () => {
  const rules = resolveScoringRules({
    goals_scored: { GKP: 10, DEF: 6, MID: 5, FWD: 4 },
    clean_sheets: { GKP: 4, DEF: 4, MID: 1, FWD: 0 },
    assists: 3,
    long_play: 2,
  });
  assert.equal(rules.source, "live-game-config");
  assert.equal(rules.goals.DEF, 6);
  assert.equal(rules.cleanSheets.MID, 1);
  assert.equal(rules.assists, 3);
});

test("scoring rules fall back to the published values when a field is missing", () => {
  const rules = resolveScoringRules({ assists: 3 });
  assert.equal(rules.goals.FWD, FALLBACK_SCORING_RULES.goals.FWD);
  assert.equal(rules.defensiveContributionThreshold.DEF, 10);
  assert.equal(rules.defensiveContributionThreshold.MID, 12);
});

test("absent scoring configuration uses the static fallback", () => {
  assert.equal(resolveScoringRules(null).source, "static-fallback");
});

// --- per-90 rates --------------------------------------------------------

test("rates with a large minutes sample stay close to the observation", () => {
  const rates = estimatePlayerRates(
    rateSource({ minutes: 3_200, expected_goals_per_90: "0.8" }),
    "FWD",
  );
  assert.ok(rates.expectedGoals > 0.65, `expected > 0.65, got ${rates.expectedGoals}`);
  assert.ok(rates.observationWeight > 0.75);
});

test("rates with a thin minutes sample are pulled toward the prior", () => {
  const thin = estimatePlayerRates(
    rateSource({ minutes: 90, expected_goals_per_90: "0.8" }),
    "FWD",
  );
  const established = estimatePlayerRates(
    rateSource({ minutes: 3_200, expected_goals_per_90: "0.8" }),
    "FWD",
  );
  assert.ok(thin.expectedGoals < established.expectedGoals);
  assert.ok(thin.observationWeight < 0.2);
});

test("a player with no minutes is priced entirely off the position prior", () => {
  const cheap = estimatePlayerRates(rateSource({ minutes: 0, now_cost: 45 }), "FWD");
  const premium = estimatePlayerRates(rateSource({ minutes: 0, now_cost: 115 }), "FWD");
  assert.equal(cheap.observationWeight, 0);
  assert.ok(premium.expectedGoals > cheap.expectedGoals);
  assert.ok(cheap.notes.some((note) => note.includes("No Premier League minutes")));
});

test("penalty and set-piece duty lift the relevant rate", () => {
  const base = estimatePlayerRates(rateSource(), "MID");
  const taker = estimatePlayerRates(rateSource({ penalties_order: 1 }), "MID");
  const corners = estimatePlayerRates(
    rateSource({ corners_and_indirect_freekicks_order: 1 }),
    "MID",
  );
  assert.ok(taker.expectedGoals > base.expectedGoals);
  assert.ok(corners.expectedAssists > base.expectedAssists);
  assert.ok(taker.notes.includes("First-choice penalty taker"));
});

test("goalkeepers get a save rate and outfield players do not", () => {
  const keeper = estimatePlayerRates(rateSource({ saves_per_90: "3.4" }), "GK");
  const defender = estimatePlayerRates(rateSource({ saves_per_90: "3.4" }), "DEF");
  assert.ok(keeper.saves > 2);
  assert.equal(defender.saves, 0);
});

// --- team strength -------------------------------------------------------

function squadFor(teamId: number, expectedGoals: number, conceded: number): SquadMember[] {
  return Array.from({ length: 11 }, (_, index) => ({
    playerId: teamId * 100 + index,
    teamId,
    expectedMinutes: 90,
    rates: estimatePlayerRates(
      rateSource({
        minutes: 3_000,
        expected_goals_per_90: String(expectedGoals),
        expected_goals_conceded_per_90: String(conceded),
      }),
      "MID",
    ),
  }));
}

test("a higher-scoring squad produces a stronger attack rating", () => {
  const strengths = buildTeamStrengths([
    ...squadFor(1, 0.22, 0.9),
    ...squadFor(2, 0.05, 1.9),
  ]);
  const strong = strengths.get(1)!;
  const weak = strengths.get(2)!;
  assert.ok(strong.attackStrength > weak.attackStrength);
  assert.ok(strong.defenceWeakness < weak.defenceWeakness);
});

test("fixture expectation responds to venue and opponent quality", () => {
  const strengths = buildTeamStrengths([
    ...squadFor(1, 0.22, 0.9),
    ...squadFor(2, 0.05, 1.9),
  ]);
  const home = expectFixture(strengths, 1, 2, true, 2);
  const away = expectFixture(strengths, 1, 2, false, 2);
  assert.ok(home.expectedGoalsFor > away.expectedGoalsFor);
  // Clean sheet is the zero mass of the goals-against Poisson.
  assert.ok(Math.abs(home.cleanSheetProbability - Math.exp(-home.expectedGoalsAgainst)) < 1e-9);
});

test("an unknown team falls back to the official difficulty rating", () => {
  const empty = new Map();
  const easy = expectFixture(empty, 1, 2, true, 1);
  const hard = expectFixture(empty, 1, 2, true, 5);
  assert.ok(easy.expectedGoalsFor > hard.expectedGoalsFor);
  assert.ok(easy.cleanSheetProbability > hard.cleanSheetProbability);
});

test("league-average inputs produce roughly league-average goals", () => {
  const strengths = buildTeamStrengths([
    ...squadFor(1, LEAGUE_GOALS_PER_TEAM / 11, LEAGUE_GOALS_PER_TEAM),
    ...squadFor(2, LEAGUE_GOALS_PER_TEAM / 11, LEAGUE_GOALS_PER_TEAM),
  ]);
  const neutral = expectFixture(strengths, 1, 2, true, 3);
  assert.ok(Math.abs(neutral.expectedGoalsFor - LEAGUE_GOALS_PER_TEAM * 1.09) < 0.25);
});

// --- international workload ---------------------------------------------

const testWorkload: TournamentWorkload = {
  tournament: "Test Cup",
  firstGameweek: 1,
  lastGameweek: 4,
  signals: [
    { regionId: 241, nation: "England", stage: "finalist", confidence: 0.6, source: "test" },
    { regionId: 99, nation: "Groupland", stage: "group", confidence: 0.6, source: "test" },
  ],
};

test("workload impact decays across the opening gameweeks", () => {
  const first = workloadImpact(241, 1, testWorkload)!;
  const second = workloadImpact(241, 2, testWorkload)!;
  assert.ok(first.startProbabilityMultiplier < second.startProbabilityMultiplier);
  assert.ok(second.startProbabilityMultiplier < 1);
  assert.equal(workloadImpact(241, 9, testWorkload), null);
});

test("nations without a deep run or without an entry are untouched", () => {
  assert.equal(workloadImpact(99, 1, testWorkload), null);
  assert.equal(workloadImpact(500, 1, testWorkload), null);
  assert.equal(workloadImpact(null, 1, testWorkload), null);
});

test("applying workload preserves the minutes probability invariant", () => {
  const projection = {
    expectedMinutes: 85,
    startProbability: 95,
    substituteProbability: 3,
    zeroMinutesProbability: 2,
    sixtyMinuteProbability: 88,
    expectedMinutesIfStart: 88,
    expectedMinutesIfSubstitute: 19,
    earlySubstitutionProbability: 7,
    confidence: 90,
    reasons: ["baseline"],
    modelVersion: "expected-minutes-baseline-v1" as const,
  };
  const adjusted = applyWorkload(projection, workloadImpact(241, 1, testWorkload)!);
  assert.equal(
    adjusted.startProbability + adjusted.substituteProbability + adjusted.zeroMinutesProbability,
    100,
  );
  assert.ok(adjusted.startProbability < projection.startProbability);
  assert.ok(adjusted.expectedMinutes < projection.expectedMinutes);
  assert.ok(adjusted.expectedMinutes >= 0 && adjusted.expectedMinutes <= 90);
  assert.equal(adjusted.modelVersion, "expected-minutes-workload-v1");
});

// --- end-to-end component behaviour -------------------------------------

function element(overrides: Partial<FplElement> = {}): FplElement {
  return {
    id: 1,
    web_name: "Test Player",
    team: 1,
    element_type: 3,
    now_cost: 70,
    minutes: 2_700,
    starts: 30,
    bps: 600,
    chance_of_playing_next_round: null,
    ep_next: "4.0",
    form: "4.0",
    points_per_game: "4.5",
    total_points: 140,
    selected_by_percent: "10.0",
    transfers_in_event: 100,
    expected_goals_per_90: "0.3",
    expected_assists_per_90: "0.2",
    expected_goals_conceded_per_90: "1.3",
    defensive_contribution_per_90: "8",
    saves_per_90: "0",
    clean_sheets_per_90: "0.3",
    yellow_cards: 5,
    red_cards: 0,
    region: 200,
    ...overrides,
  };
}

const oneFixture: FplFixture[] = [
  {
    id: 1,
    event: 1,
    team_h: 1,
    team_a: 2,
    team_h_difficulty: 3,
    team_a_difficulty: 3,
    kickoff_time: "2026-08-21T19:00:00Z",
    finished: false,
  },
];
const twoTeams = new Map([[1, "AAA"], [2, "BBB"]]);

test("a player who cannot play projects zero points", () => {
  const injured = projectPlayer(
    element({ status: "i", chance_of_playing_next_round: 0 }),
    oneFixture,
    twoTeams,
    1,
  );
  assert.equal(injured.expectedMinutes.startProbability, 0);
  assert.equal(injured.xp1, 0);
  assert.equal(injured.xp3, 0);
});

test("projection components sum to the reported total", () => {
  const projection = projectPlayer(element(), oneFixture, twoTeams, 1);
  const breakdown = projection.pointsBreakdown!;
  const sum =
    breakdown.appearance + breakdown.goals + breakdown.assists + breakdown.cleanSheet
    + breakdown.goalsConceded + breakdown.saves + breakdown.defensiveContribution
    + breakdown.bonus + breakdown.cards;
  assert.ok(Math.abs(sum - breakdown.total) < 0.06);
});

test("only goalkeepers and defenders carry a goals-conceded penalty", () => {
  const keeper = projectPlayer(element({ element_type: 1, saves_per_90: "3.2" }), oneFixture, twoTeams, 1);
  const midfielder = projectPlayer(element({ element_type: 3 }), oneFixture, twoTeams, 1);
  assert.ok(keeper.pointsBreakdown!.goalsConceded < 0);
  assert.equal(midfielder.pointsBreakdown!.goalsConceded, 0);
  assert.ok(keeper.pointsBreakdown!.saves > 0);
  assert.equal(midfielder.pointsBreakdown!.saves, 0);
});

test("a high defensive-action rate earns defensive-contribution points", () => {
  const holder = projectPlayer(
    element({ defensive_contribution_per_90: "15" }),
    oneFixture,
    twoTeams,
    1,
  );
  const attacker = projectPlayer(
    element({ defensive_contribution_per_90: "2" }),
    oneFixture,
    twoTeams,
    1,
  );
  assert.ok(holder.pointsBreakdown!.defensiveContribution > attacker.pointsBreakdown!.defensiveContribution);
  assert.ok(holder.pointsBreakdown!.defensiveContribution > 0.5);
});

test("the projection context supplies live scoring rules and team strength", () => {
  const players = [element({ id: 1, team: 1 }), element({ id: 2, team: 2 })];
  const minutes = new Map(
    players.map((player) => [
      Number(player.id),
      projectPlayer(player, oneFixture, twoTeams, 1).expectedMinutes,
    ]),
  );
  const context = buildProjectionContext(players, minutes, { assists: 3 });
  assert.equal(context.scoring.source, "live-game-config");
  assert.ok(context.ratesByPlayer.has(1));
  assert.ok(context.teamStrengths.has(1));
});

test("international workload lowers the projection of an affected player", () => {
  const players = [element({ id: 1, region: 241 })];
  const minutes = new Map([[1, projectPlayer(players[0], oneFixture, twoTeams, 1).expectedMinutes]]);
  const context = { ...buildProjectionContext(players, minutes), workload: testWorkload };
  const rested = projectPlayer(players[0], oneFixture, twoTeams, 1, undefined, undefined, undefined, context);
  const unaffected = projectPlayer(
    element({ id: 1, region: 500 }),
    oneFixture,
    twoTeams,
    1,
    undefined,
    undefined,
    undefined,
    context,
  );
  assert.ok(rested.xp1 < unaffected.xp1);
  assert.equal(rested.expectedMinutes.modelVersion, "expected-minutes-workload-v1");
});
