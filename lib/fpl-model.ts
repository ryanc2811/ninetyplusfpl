import type {
  DataQualitySummary,
  ExpectedMinutesProjection,
  MatchForecastProjection,
  PlayerPointsProjection,
  PlayerProjection,
  Position,
} from "./contracts/fpl";
import { VERIFIED_TEAM_ROLE_SIGNALS } from "./team-news.ts";

export type { Position };
export type FplElement = Record<string, number | string | boolean | null>;

export type FplFixture = {
  id: number;
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
  fixtureId: number;
  opponent: string;
  venue: "H" | "A";
  difficulty: number;
  event: number;
  teamExpectedGoals?: number;
  cleanSheetProbability?: number;
};

const POSITION_BY_ID: Record<number, Position> = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };
const POSITION_PRIOR: Record<Position, number> = { GK: 2.7, DEF: 2.8, MID: 3.2, FWD: 3 };
const POSITION_FLOOR_PRICE: Record<Position, number> = { GK: 4, DEF: 4, MID: 4.5, FWD: 4.5 };
const FIXTURE_MULTIPLIER: Record<number, number> = { 1: 1.22, 2: 1.11, 3: 1, 4: 0.89, 5: 0.78 };
const TEAM_FORMATIONS = [
  { label: "3-4-3", GK: 1, DEF: 3, MID: 4, FWD: 3 },
  { label: "3-5-2", GK: 1, DEF: 3, MID: 5, FWD: 2 },
  { label: "4-4-2", GK: 1, DEF: 4, MID: 4, FWD: 2 },
  { label: "4-3-3", GK: 1, DEF: 4, MID: 3, FWD: 3 },
  { label: "4-5-1", GK: 1, DEF: 4, MID: 5, FWD: 1 },
  { label: "5-4-1", GK: 1, DEF: 5, MID: 4, FWD: 1 },
  { label: "5-3-2", GK: 1, DEF: 5, MID: 3, FWD: 2 },
  { label: "5-2-3", GK: 1, DEF: 5, MID: 2, FWD: 3 },
] as const;

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

function playerAvailability(player: FplElement) {
  if (player.chance_of_playing_next_round !== null && player.chance_of_playing_next_round !== undefined) {
    return clamp(numeric(player.chance_of_playing_next_round, 100) / 100, 0, 1);
  }
  return {
    a: 1,
    d: 0.75,
    i: 0,
    s: 0,
    u: 0,
    n: 0,
  }[String(player.status ?? "a")] ?? 0.8;
}

function fixturesForTeam(
  teamId: number,
  fixtures: FplFixture[],
  teams: Map<number, string>,
  nextEvent: number,
  matchForecasts?: Map<number, MatchForecastProjection>,
) {
  return fixtures
    .filter((fixture) => !fixture.finished && fixture.event !== null && fixture.event >= nextEvent)
    .filter((fixture) => fixture.team_h === teamId || fixture.team_a === teamId)
    .sort((a, b) => numeric(a.event) - numeric(b.event))
    .slice(0, 3)
    .map<FixtureContext>((fixture) => {
      const home = fixture.team_h === teamId;
      const opponentId = home ? fixture.team_a : fixture.team_h;
      const matchForecast = matchForecasts?.get(fixture.id);
      return {
        fixtureId: fixture.id,
        opponent: teams.get(opponentId) || "TBC",
        venue: home ? "H" : "A",
        difficulty: home ? fixture.team_h_difficulty : fixture.team_a_difficulty,
        event: numeric(fixture.event),
        teamExpectedGoals: matchForecast
          ? home
            ? matchForecast.expectedHomeGoals
            : matchForecast.expectedAwayGoals
          : undefined,
        cleanSheetProbability: matchForecast
          ? home
            ? matchForecast.homeCleanSheetProbability
            : matchForecast.awayCleanSheetProbability
          : undefined,
      };
    });
}

export function projectExpectedMinutes(player: FplElement, matchesObserved: number): ExpectedMinutesProjection {
  const minutes = numeric(player.minutes);
  const starts = numeric(player.starts);
  const price = numeric(player.now_cost) / 10;
  const position = POSITION_BY_ID[numeric(player.element_type)] || "MID";
  const availability = playerAvailability(player);
  const observedMatches = Math.max(1, matchesObserved);
  const observedStartRate = clamp(starts / observedMatches, 0, 1);
  const priceRolePrior = clamp(
    0.32 + Math.max(0, price - POSITION_FLOOR_PRICE[position]) * 0.065,
    0.3,
    0.88,
  );
  const sampleWeight = clamp(observedMatches / 12, 0.15, 0.85);
  const roleStartRate = starts > 0
    ? observedStartRate * sampleWeight + priceRolePrior * (1 - sampleWeight)
    : priceRolePrior * 0.72;
  const startProbability = clamp(roleStartRate * availability, 0, 0.98);
  const substituteProbability = clamp((1 - roleStartRate) * 0.34 * availability, 0, 1 - startProbability);
  const expectedMinutesIfStart = starts > 0 ? clamp(minutes / starts, 55, 90) : position === "GK" ? 90 : 76;
  const expectedMinutesIfSubstitute = position === "GK" ? 5 : 19;
  const expectedMinutes = clamp(
    startProbability * expectedMinutesIfStart + substituteProbability * expectedMinutesIfSubstitute,
    0,
    90,
  );
  const sixtyGivenStart = clamp((expectedMinutesIfStart - 48) / 25, 0.25, 0.99);
  const sixtyMinuteProbability = startProbability * sixtyGivenStart;
  const earlySubstitutionProbability = startProbability * (1 - sixtyGivenStart);
  const startPercent = Math.round(startProbability * 100);
  const substitutePercent = Math.round(substituteProbability * 100);
  const zeroPercent = Math.max(0, 100 - startPercent - substitutePercent);
  const sampleConfidence = clamp((starts + observedMatches) / 50, 0.1, 1);
  const newsConfidence = player.chance_of_playing_next_round === null ? 0.55 : 0.9;
  const confidence = Math.round(clamp((sampleConfidence * 0.65 + newsConfidence * 0.35) * 100, 18, 94));
  const reasons = [
    starts > 0 ? `${starts} starts across a ${observedMatches}-match observation window` : "No established start sample; role prior used",
    `${Math.round(expectedMinutesIfStart)} average minutes when starting`,
    availability < 1 ? `${Math.round(availability * 100)}% official availability signal` : "No active availability restriction",
  ];

  return {
    expectedMinutes: round(expectedMinutes),
    startProbability: startPercent,
    substituteProbability: substitutePercent,
    zeroMinutesProbability: zeroPercent,
    sixtyMinuteProbability: Math.round(sixtyMinuteProbability * 100),
    expectedMinutesIfStart: round(expectedMinutesIfStart),
    expectedMinutesIfSubstitute,
    earlySubstitutionProbability: Math.round(earlySubstitutionProbability * 100),
    confidence,
    reasons,
    modelVersion: "expected-minutes-baseline-v1",
  };
}

function establishedRoleProbability(player: FplElement, matchesObserved: number) {
  const position = POSITION_BY_ID[numeric(player.element_type)] || "MID";
  const price = numeric(player.now_cost) / 10;
  const priceRole = 0.55 + Math.max(0, price - POSITION_FLOOR_PRICE[position]) * 0.08;
  const observedStartRate = matchesObserved > 0
    ? clamp(numeric(player.starts) / matchesObserved, 0, 1)
    : 0;
  return clamp(Math.max(priceRole, observedStartRate), 0.55, 0.94);
}

function normalizeName(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function rebalanceProjection(
  projection: ExpectedMinutesProjection,
  startBoost: number,
  evidence: string[],
  confidence: number,
) {
  if (startBoost <= 0) return projection;
  const originalStart = projection.startProbability / 100;
  const originalSubstitute = projection.substituteProbability / 100;
  const nextStart = clamp(originalStart + startBoost, 0, 0.98);
  const remaining = 1 - nextStart;
  const nonStartTotal = Math.max(0.0001, 1 - originalStart);
  const nextSubstitute = clamp(
    originalSubstitute * (remaining / nonStartTotal),
    0,
    remaining,
  );
  const sixtyGivenStart = clamp(
    (projection.expectedMinutesIfStart - 48) / 25,
    0.25,
    0.99,
  );
  return {
    ...projection,
    startProbability: Math.round(nextStart * 100),
    substituteProbability: Math.round(nextSubstitute * 100),
    zeroMinutesProbability: Math.max(
      0,
      100 - Math.round(nextStart * 100) - Math.round(nextSubstitute * 100),
    ),
    expectedMinutes: round(
      nextStart * projection.expectedMinutesIfStart
      + nextSubstitute * projection.expectedMinutesIfSubstitute,
    ),
    sixtyMinuteProbability: Math.round(nextStart * sixtyGivenStart * 100),
    earlySubstitutionProbability: Math.round(nextStart * (1 - sixtyGivenStart) * 100),
    confidence: Math.round(clamp(Math.max(projection.confidence / 100, confidence) * 100, 18, 94)),
    reasons: [...projection.reasons, ...evidence],
    modelVersion: "expected-minutes-team-opportunity-v1" as const,
  };
}

function setStartProbability(
  projection: ExpectedMinutesProjection,
  requestedStart: number,
  evidence: string,
  confidence: number,
) {
  const originalStart = projection.startProbability / 100;
  const originalSubstitute = projection.substituteProbability / 100;
  const nextStart = clamp(requestedStart, 0, 0.98);
  const remaining = 1 - nextStart;
  const nonStartTotal = Math.max(0.0001, 1 - originalStart);
  const nextSubstitute = clamp(
    originalSubstitute * (remaining / nonStartTotal),
    0,
    remaining,
  );
  const startPercent = Math.round(nextStart * 100);
  const substitutePercent = Math.round(nextSubstitute * 100);
  const sixtyGivenStart = clamp(
    (projection.expectedMinutesIfStart - 48) / 25,
    0.25,
    0.99,
  );
  return {
    ...projection,
    startProbability: startPercent,
    substituteProbability: substitutePercent,
    zeroMinutesProbability: Math.max(0, 100 - startPercent - substitutePercent),
    expectedMinutes: round(
      nextStart * projection.expectedMinutesIfStart
      + nextSubstitute * projection.expectedMinutesIfSubstitute,
    ),
    sixtyMinuteProbability: Math.round(nextStart * sixtyGivenStart * 100),
    earlySubstitutionProbability: Math.round(nextStart * (1 - sixtyGivenStart) * 100),
    confidence: Math.round(
      clamp(Math.max(projection.confidence / 100, confidence) * 100, 18, 94),
    ),
    reasons: Math.abs(nextStart - originalStart) >= 0.025
      ? [...projection.reasons, evidence]
      : projection.reasons,
    modelVersion: "expected-minutes-team-lineup-v1" as const,
  };
}

function lineupRoleScore(
  player: FplElement,
  projection: ExpectedMinutesProjection,
  matchesObserved: number,
) {
  const position = POSITION_BY_ID[numeric(player.element_type)] || "MID";
  const price = numeric(player.now_cost) / 10;
  const observedStartRate = numeric(player.starts) > 0
    ? clamp(numeric(player.starts) / Math.max(1, matchesObserved), 0, 1)
    : 0;
  const priceSignal = clamp(
    (price - POSITION_FLOOR_PRICE[position]) / 7,
    0,
    1,
  );
  const ownershipSignal = clamp(
    Math.log1p(numeric(player.selected_by_percent)) / Math.log(101),
    0,
    1,
  );
  return projection.startProbability / 100 * 0.5
    + observedStartRate * 0.25
    + priceSignal * 0.15
    + ownershipSignal * 0.1;
}

function allocateStartingProbability(
  candidates: FplElement[],
  target: number,
  projections: Map<number, ExpectedMinutesProjection>,
  matchesObserved: number,
) {
  if (!candidates.length) return new Map<number, number>();
  const scored = candidates.map((player) => ({
    player,
    score: lineupRoleScore(player, projections.get(numeric(player.id))!, matchesObserved),
    availability: playerAvailability(player),
  }));
  let lower = -2;
  let upper = 2;
  const temperature = 0.075;
  for (let iteration = 0; iteration < 70; iteration += 1) {
    const threshold = (lower + upper) / 2;
    const total = scored.reduce(
      (sum, item) =>
        sum + item.availability / (1 + Math.exp(-(item.score - threshold) / temperature)),
      0,
    );
    if (total > target) lower = threshold;
    else upper = threshold;
  }
  const threshold = (lower + upper) / 2;
  return new Map(
    scored.map((item) => [
      numeric(item.player.id),
      clamp(
        item.availability / (1 + Math.exp(-(item.score - threshold) / temperature)),
        0,
        0.98,
      ),
    ]),
  );
}

function applyTeamLineupConstraints(
  players: FplElement[],
  projections: Map<number, ExpectedMinutesProjection>,
  matchesObserved: number,
) {
  const teamIds = [...new Set(players.map((player) => numeric(player.team)))];
  for (const teamId of teamIds) {
    const teamPlayers = players.filter((player) => numeric(player.team) === teamId);
    if (teamPlayers.length < 15) continue;
    if (
      teamPlayers.every(
        (player) =>
          projections.get(numeric(player.id))?.modelVersion
          === "expected-minutes-team-lineup-v1",
      )
    ) {
      continue;
    }
    const availableByPosition = (position: Position) =>
      teamPlayers.filter(
        (player) =>
          POSITION_BY_ID[numeric(player.element_type)] === position
          && playerAvailability(player) > 0,
      );
    const viableFormations = TEAM_FORMATIONS.filter(
      (formation) =>
        availableByPosition("GK").length >= formation.GK
        && availableByPosition("DEF").length >= formation.DEF
        && availableByPosition("MID").length >= formation.MID
        && availableByPosition("FWD").length >= formation.FWD,
    );
    const formation = viableFormations
      .map((candidate) => {
        const score = (["GK", "DEF", "MID", "FWD"] as Position[]).reduce(
          (total, position) => {
            const count = candidate[position];
            const positional = availableByPosition(position)
              .map((player) => lineupRoleScore(
                player,
                projections.get(numeric(player.id))!,
                matchesObserved,
              ))
              .sort((a, b) => b - a)
              .slice(0, count);
            return total + positional.reduce((sum, value) => sum + value, 0);
          },
          0,
        );
        return { candidate, score };
      })
      .sort((a, b) => b.score - a.score)[0]?.candidate;
    if (!formation) continue;

    for (const position of ["GK", "DEF", "MID", "FWD"] as Position[]) {
      const positional = teamPlayers.filter(
        (player) => POSITION_BY_ID[numeric(player.element_type)] === position,
      );
      const probabilities = allocateStartingProbability(
        positional,
        formation[position],
        projections,
        matchesObserved,
      );
      const ranked = [...positional].sort(
        (a, b) =>
          (probabilities.get(numeric(b.id)) ?? 0)
          - (probabilities.get(numeric(a.id)) ?? 0),
      );
      for (const player of positional) {
        const requested = probabilities.get(numeric(player.id)) ?? 0;
        const rank = ranked.findIndex((candidate) => numeric(candidate.id) === numeric(player.id)) + 1;
        projections.set(
          numeric(player.id),
          setStartProbability(
            projections.get(numeric(player.id))!,
            requested,
            `Team lineup constraint: ${formation.label} inferred; ranked ${rank}/${positional.length} among ${position} candidates.`,
            0.62,
          ),
        );
      }
    }
  }
}

export function projectExpectedMinutesForSquad(
  players: FplElement[],
  matchesObserved: number,
  baseOverrides?: Map<number, ExpectedMinutesProjection>,
) {
  const projections = new Map(
    players.map((player) => [
      numeric(player.id),
      baseOverrides?.get(numeric(player.id))
        ?? projectExpectedMinutes(player, matchesObserved),
    ]),
  );
  const boosts = new Map<number, { value: number; evidence: string[]; confidence: number }>();
  const unavailable = players.filter((player) => playerAvailability(player) <= 0.25);

  for (const absent of unavailable) {
    const absentName = normalizeName(absent.web_name);
    const absentPosition = numeric(absent.element_type);
    const candidates = players.filter(
      (player) =>
        numeric(player.team) === numeric(absent.team)
        && numeric(player.element_type) === absentPosition
        && numeric(player.id) !== numeric(absent.id)
        && playerAvailability(player) >= 0.6,
    );
    if (!candidates.length) continue;

    const vacancy = establishedRoleProbability(absent, matchesObserved)
      * (1 - playerAvailability(absent));
    const roleSignal = VERIFIED_TEAM_ROLE_SIGNALS.find(
      (signal) => normalizeName(signal.unavailablePlayer) === absentName,
    );
    const signalledWeights = new Map(
      roleSignal?.replacements.map((replacement) => [
        normalizeName(replacement.player),
        replacement.opportunityShare,
      ]) ?? [],
    );
    const genericRanked = [...candidates]
      .sort((a, b) => {
        const aProjection = projections.get(numeric(a.id))!;
        const bProjection = projections.get(numeric(b.id))!;
        return bProjection.startProbability - aProjection.startProbability
          || numeric(b.now_cost) - numeric(a.now_cost);
      })
      .slice(0, 3);
    const genericScores = new Map(
      genericRanked.map((candidate) => [
        numeric(candidate.id),
        Math.max(
          0.1,
          (projections.get(numeric(candidate.id))?.startProbability ?? 0) / 100
          + numeric(candidate.now_cost) / 100,
        ),
      ]),
    );
    const genericTotal = [...genericScores.values()].reduce((sum, value) => sum + value, 0);

    for (const candidate of candidates) {
      const candidateName = normalizeName(candidate.web_name);
      const candidateProjection = projections.get(numeric(candidate.id))!;
      if (
        candidateProjection.modelVersion === "expected-minutes-team-opportunity-v1"
        || candidateProjection.modelVersion === "expected-minutes-team-lineup-v1"
      ) {
        continue;
      }
      const signalledShare = signalledWeights.get(candidateName);
      const genericShare = genericScores.has(numeric(candidate.id))
        ? genericScores.get(numeric(candidate.id))! / Math.max(0.0001, genericTotal)
        : 0;
      const share = signalledShare ?? (roleSignal ? 0 : genericShare);
      if (share <= 0) continue;
      const existing = boosts.get(numeric(candidate.id)) ?? {
        value: 0,
        evidence: [],
        confidence: 0.5,
      };
      existing.value += vacancy * share;
      existing.confidence = Math.max(existing.confidence, roleSignal?.confidence ?? 0.55);
      existing.evidence.push(
        roleSignal
          ? `Team opportunity: ${roleSignal.rationale} Estimated replacement share ${Math.round(share * 100)}%.`
          : `Team opportunity: ${String(absent.web_name)} is unavailable; ${Math.round(share * 100)}% of the positional vacancy is assigned here.`,
      );
      boosts.set(numeric(candidate.id), existing);
    }
  }

  for (const [playerId, boost] of boosts) {
    projections.set(
      playerId,
      rebalanceProjection(
        projections.get(playerId)!,
        boost.value,
        boost.evidence,
        boost.confidence,
      ),
    );
  }
  applyTeamLineupConstraints(players, projections, matchesObserved);
  return projections;
}

function baselinePoints(player: FplElement, position: Position, preseason: boolean) {
  const officialExpected = numeric(player.ep_next);
  const form = numeric(player.form);
  const pointsPerGame = numeric(player.points_per_game);
  const minutes = numeric(player.minutes);
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
  const hasHistoricalSeasonData = preseason && minutes >= 180 && pointsPerGame > 0;
  if (hasHistoricalSeasonData) {
    const reliability = clamp(minutes / 1_800, 0.1, 1);
    const historyWeight = 0.55 * reliability;
    const officialWeight = officialExpected > 0 ? 0.15 : 0;
    const priceWeight = 1 - historyWeight - officialWeight;
    const officialSignal = Math.max(officialExpected, pricePrior * 0.75);
    return pointsPerGame * historyWeight
      + officialSignal * officialWeight
      + pricePrior * priceWeight;
  }
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

export function projectPlayer(
  player: FplElement,
  fixtures: FplFixture[],
  teams: Map<number, string>,
  nextEvent: number,
  expectedMinutesOverride?: ExpectedMinutesProjection,
  matchForecasts?: Map<number, MatchForecastProjection>,
  pointsForecasts?: PlayerPointsProjection[],
): PlayerProjection {
  const position = POSITION_BY_ID[numeric(player.element_type)] || "MID";
  const teamId = numeric(player.team);
  const upcoming = fixturesForTeam(teamId, fixtures, teams, nextEvent, matchForecasts);
  const expectedMinutes =
    expectedMinutesOverride ??
    projectExpectedMinutes(player, nextEvent === 1 ? 38 : nextEvent - 1);
  const baseline = baselinePoints(player, position, nextEvent === 1);
  const roleFactor = 0.36 + (expectedMinutes.expectedMinutes / 90) * 0.64;
  const fixturePoints = upcoming.map((fixture, index) => {
    const attackFactor = fixture.teamExpectedGoals === undefined
      ? undefined
      : clamp(fixture.teamExpectedGoals / 1.45, 0.72, 1.35);
    const defenceFactor = fixture.cleanSheetProbability === undefined
      ? undefined
      : clamp(0.78 + fixture.cleanSheetProbability * 0.5, 0.78, 1.28);
    const structuralFactor =
      attackFactor === undefined || defenceFactor === undefined
        ? undefined
        : position === "GK"
          ? defenceFactor
          : position === "DEF"
            ? attackFactor * 0.25 + defenceFactor * 0.75
            : position === "MID"
              ? attackFactor * 0.85 + defenceFactor * 0.15
              : attackFactor;
    const difficultyFactor = structuralFactor ?? FIXTURE_MULTIPLIER[fixture.difficulty] ?? 1;
    const homeFactor = fixture.venue === "H" ? 1.035 : 0.965;
    const horizonDiscount = 1 - index * 0.025;
    return round(clamp(baseline * roleFactor * difficultyFactor * homeFactor * horizonDiscount, 0.2, 14));
  });
  const fallback = round(clamp(baseline * roleFactor, 0.2, 12));
  const simulatedByFixture = new Map(
    (pointsForecasts ?? []).map((forecast) => [forecast.fixtureId, forecast]),
  );
  const simulatedPoints = upcoming.map((fixture) =>
    simulatedByFixture.get(fixture.fixtureId)?.expectedPoints,
  );
  const usesSimulation = simulatedPoints.some((score) => score !== undefined);
  const blendedPoints = fixturePoints.map((score, index) => simulatedPoints[index] ?? score);
  const xp1 = round(blendedPoints[0] ?? fallback);
  const xp3 = round(blendedPoints.length ? blendedPoints.reduce((sum, score) => sum + score, 0) : fallback * 2.75);
  const firstFixture = upcoming[0];
  const confidence = confidenceScore(player, upcoming.length, expectedMinutes.startProbability);
  const availability = playerAvailability(player) * 100;

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
    minutes: expectedMinutes.expectedMinutes,
    ownership: numeric(player.selected_by_percent),
    risk: availability < 75 || expectedMinutes.startProbability < 58 ? "High" : expectedMinutes.startProbability < 78 ? "Medium" : "Low",
    trend: round(numeric(player.transfers_in_event) / Math.max(1, numeric(player.selected_by_percent, 1) * 10000)),
    confidence,
    fixtures: upcoming.map((fixture) => `${fixture.opponent} (${fixture.venue})`),
    breakdown: usesSimulation ? blendedPoints.map(round) : fixturePoints,
    expectedMinutes,
    teamExpectedGoals: firstFixture?.teamExpectedGoals,
    cleanSheetProbability: firstFixture?.cleanSheetProbability,
    pointsDistribution: firstFixture
      ? simulatedByFixture.get(firstFixture.fixtureId)
      : undefined,
  };
}

export function validateProjectionData(players: PlayerProjection[], fixtures: FplFixture[]): DataQualitySummary {
  const issues: string[] = [];
  const teams = new Set(players.map((player) => player.team).filter((team) => team !== "—"));
  const invalidMinutes = players.filter((player) => {
    const minutes = player.expectedMinutes;
    return minutes.expectedMinutes < 0 ||
      minutes.expectedMinutes > 90 ||
      minutes.startProbability + minutes.substituteProbability + minutes.zeroMinutesProbability !== 100;
  });
  const invalidPoints = players.filter((player) => !Number.isFinite(player.xp1) || !Number.isFinite(player.xp3));

  if (players.length < 300) issues.push(`Expected at least 300 players; received ${players.length}`);
  if (teams.size !== 20) issues.push(`Expected 20 teams; received ${teams.size}`);
  if (fixtures.length < 100) issues.push(`Expected a season fixture list; received ${fixtures.length}`);
  if (invalidMinutes.length) issues.push(`${invalidMinutes.length} players have invalid minutes probabilities`);
  if (invalidPoints.length) issues.push(`${invalidPoints.length} players have invalid point projections`);

  return {
    valid: issues.length === 0,
    issues,
    playerCount: players.length,
    fixtureCount: fixtures.length,
    teamsCovered: teams.size,
  };
}
