import type {
  DataQualitySummary,
  ExpectedMinutesProjection,
  MatchForecastProjection,
  PlayerPointsProjection,
  PlayerProjection,
  PointsBreakdown,
  Position,
  TeamOutlook,
} from "./contracts/fpl";
import { VERIFIED_TEAM_ROLE_SIGNALS } from "./team-news.ts";
import {
  estimatePlayerRates,
  LEAGUE_GOALS_PER_TEAM,
  type PlayerRates,
  type RateSource,
} from "./player-rates.ts";
import {
  buildTeamStrengths,
  expectFixture,
  type FixtureExpectation,
  type TeamStrength,
} from "./team-strength.ts";
import {
  applyWorkload,
  workloadImpact,
  type TournamentWorkload,
} from "./workload.ts";
import {
  FALLBACK_SCORING_RULES,
  resolveScoringRules,
  type RawScoringConfig,
  type ScoringRules,
} from "./scoring-rules.ts";
import {
  FALLBACK_CALIBRATION,
  fitOutputCalibration,
  type CalibrationSource,
  type OutputCalibration,
} from "./calibration.ts";

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

export type Team = { id: number; short_name: string; name?: string };

type FixtureContext = {
  fixtureId: number;
  opponent: string;
  opponentId: number;
  venue: "H" | "A";
  difficulty: number;
  event: number;
  teamExpectedGoals?: number;
  cleanSheetProbability?: number;
};

const POSITION_BY_ID: Record<number, Position> = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };
const POSITION_FLOOR_PRICE: Record<Position, number> = { GK: 4, DEF: 4, MID: 4.5, FWD: 4.5 };
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
        opponentId,
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

/** Probability that a Poisson variable with the given mean is at least `k`. */
function poissonAtLeast(k: number, mean: number) {
  if (k <= 0) return 1;
  if (mean <= 0) return 0;
  let term = Math.exp(-mean);
  let cumulative = term;
  for (let i = 1; i < k; i += 1) {
    term = (term * mean) / i;
    cumulative += term;
  }
  return clamp(1 - cumulative, 0, 1);
}

/**
 * Over-dispersion of match-level defensive action counts, as a variance-to-mean
 * ratio. Poisson assumes 1.0, which is wrong in a known direction: real counts
 * vary with game state, opponent and role far more than Poisson allows, so a
 * player whose average sits below the threshold crosses it more often than
 * Poisson predicts. 1.6 is a conservative value for counts of this kind and is
 * the one assumption here that per-match history would replace.
 */
const DEFENSIVE_ACTION_DISPERSION = 1.6;

/**
 * Probability that a negative-binomial count with the given mean and
 * variance-to-mean ratio is at least `k`. Falls back to Poisson when the ratio
 * is at or below 1, where the negative binomial is undefined.
 */
function negativeBinomialAtLeast(k: number, mean: number, dispersion: number) {
  if (k <= 0) return 1;
  if (mean <= 0) return 0;
  if (dispersion <= 1.0001) return poissonAtLeast(k, mean);

  // Parameterise by success probability p and size r so that
  // variance = mean / p and mean = r(1 - p) / p.
  const p = 1 / dispersion;
  const r = (mean * p) / (1 - p);

  let term = p ** r;
  let cumulative = term;
  for (let i = 0; i < k - 1; i += 1) {
    term *= ((r + i) / (i + 1)) * (1 - p);
    cumulative += term;
  }
  return clamp(1 - cumulative, 0, 1);
}

/**
 * Expected value of `floor(X / divisor)` for a Poisson variable, used for the
 * goals-conceded penalty which only scores on completed pairs of goals.
 */
function expectedFloorDivision(mean: number, divisor: number) {
  if (mean <= 0) return 0;
  let term = Math.exp(-mean);
  let total = 0;
  for (let k = 1; k <= 15; k += 1) {
    term = (term * mean) / k;
    total += Math.floor(k / divisor) * term;
  }
  return total;
}

export type ProjectionContext = {
  scoring: ScoringRules;
  teamStrengths: Map<number, TeamStrength>;
  ratesByPlayer: Map<number, PlayerRates>;
  calibration: OutputCalibration;
  /** Full club names, which reference datasets use in place of short codes. */
  teamNamesById?: Map<number, string>;
  workload?: TournamentWorkload;
};

/**
 * Builds the shared context a squad-wide projection needs: scoring values, the
 * per-90 rates for every player and the team strength ratings those rates imply.
 */
export function buildProjectionContext(
  players: FplElement[],
  expectedMinutesByPlayer: Map<number, ExpectedMinutesProjection>,
  scoringConfig?: RawScoringConfig | null,
  workload?: TournamentWorkload,
  teamNamesById?: Map<number, string>,
): ProjectionContext {
  // Fit the rate-to-output mapping from this snapshot before estimating any
  // player, so every rate is expressed in realised FPL output.
  const calibration = fitOutputCalibration(
    players as unknown as CalibrationSource[],
  );
  const ratesByPlayer = new Map<number, PlayerRates>();
  const squad = players.map((player) => {
    const position = POSITION_BY_ID[numeric(player.element_type)] || "MID";
    const rates = estimatePlayerRates(player as unknown as RateSource, position, calibration);
    const playerId = numeric(player.id);
    ratesByPlayer.set(playerId, rates);
    return {
      playerId,
      teamId: numeric(player.team),
      rates,
      expectedMinutes: expectedMinutesByPlayer.get(playerId)?.expectedMinutes ?? 0,
    };
  });
  return {
    scoring: resolveScoringRules(scoringConfig),
    teamStrengths: buildTeamStrengths(squad),
    ratesByPlayer,
    calibration,
    teamNamesById,
    workload,
  };
}

/**
 * Expected points for one fixture, summed over the FPL scoring events.
 *
 * Every component is conditioned on playing time, so a player with no expected
 * minutes scores nothing rather than retaining a fraction of a baseline.
 */
export function projectFixturePoints(
  position: Position,
  rates: PlayerRates,
  minutes: ExpectedMinutesProjection,
  fixture: FixtureExpectation,
  teamBaselineExpectedGoals: number,
  teamBaselineExpectedGoalsConceded: number,
  scoring: ScoringRules,
): PointsBreakdown {
  const startProbability = minutes.startProbability / 100;
  const playProbability =
    startProbability + minutes.substituteProbability / 100;
  const sixtyProbability = minutes.sixtyMinuteProbability / 100;
  const minutesShare = minutes.expectedMinutes / 90;

  // Isolate the fixture effect: the player's own rate already reflects the
  // quality of the side they play for, so scale only by how this fixture
  // differs from that side's neutral expectation.
  const attackScale = teamBaselineExpectedGoals > 0
    ? clamp(fixture.expectedGoalsFor / teamBaselineExpectedGoals, 0.5, 2)
    : 1;
  const concedeScale = teamBaselineExpectedGoalsConceded > 0
    ? clamp(fixture.expectedGoalsAgainst / teamBaselineExpectedGoalsConceded, 0.5, 2)
    : 1;

  const appearance =
    playProbability * scoring.shortPlay
    + sixtyProbability * (scoring.longPlay - scoring.shortPlay);

  const goals = rates.goals * minutesShare * attackScale * scoring.goals[position];
  const assists = rates.assists * minutesShare * attackScale * scoring.assists;

  const cleanSheet =
    sixtyProbability * fixture.cleanSheetProbability * scoring.cleanSheets[position];

  // Concession only costs points where the position scores it, and only for
  // the goals conceded while the player is on the pitch.
  const goalsConceded = scoring.goalsConceded[position] !== 0
    ? expectedFloorDivision(
        fixture.expectedGoalsAgainst * minutesShare,
        scoring.goalsConcededPer,
      )
      * scoring.goalsConceded[position]
      * playProbability
    : 0;

  const saves = position === "GK"
    ? (rates.saves * minutesShare * concedeScale * scoring.saves) / scoring.savesPer
    : 0;

  // A defensive contribution needs a near-full match, so it is conditioned on
  // starting and evaluated at the minutes a start is expected to bring.
  const threshold = scoring.defensiveContributionThreshold[position];
  const defensiveContribution = Number.isFinite(threshold)
    ? startProbability
      * negativeBinomialAtLeast(
          Math.ceil(threshold),
          rates.defensiveActions * (minutes.expectedMinutesIfStart / 90),
          DEFENSIVE_ACTION_DISPERSION,
        )
      * scoring.defensiveContribution[position]
    : 0;

  const bonus = rates.bonus * minutesShare * clamp(attackScale, 0.8, 1.25) * scoring.bonus;

  const cards =
    rates.yellowCards * minutesShare * scoring.yellowCards
    + rates.redCards * minutesShare * scoring.redCards;

  const total =
    appearance + goals + assists + cleanSheet + goalsConceded + saves
    + defensiveContribution + bonus + cards;

  const round2 = (value: number) => Number(value.toFixed(2));
  return {
    appearance: round2(appearance),
    goals: round2(goals),
    assists: round2(assists),
    cleanSheet: round2(cleanSheet),
    goalsConceded: round2(goalsConceded),
    saves: round2(saves),
    defensiveContribution: round2(defensiveContribution),
    bonus: round2(bonus),
    cards: round2(cards),
    total: round2(Math.max(0, total)),
  };
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
  context?: ProjectionContext,
): PlayerProjection {
  const position = POSITION_BY_ID[numeric(player.element_type)] || "MID";
  const teamId = numeric(player.team);
  const playerId = numeric(player.id);
  const upcoming = fixturesForTeam(teamId, fixtures, teams, nextEvent, matchForecasts);
  const baseMinutes =
    expectedMinutesOverride ??
    projectExpectedMinutes(player, nextEvent === 1 ? 38 : nextEvent - 1);

  const scoring = context?.scoring ?? FALLBACK_SCORING_RULES;
  const rates =
    context?.ratesByPlayer.get(playerId)
    ?? estimatePlayerRates(
      player as unknown as RateSource,
      position,
      context?.calibration ?? FALLBACK_CALIBRATION,
    );
  const teamStrengths = context?.teamStrengths ?? new Map<number, TeamStrength>();
  const strength = teamStrengths.get(teamId);

  // Neutral-fixture expectation for this side, used to separate the fixture
  // effect from the team quality already embedded in the player's own rates.
  const teamBaselineExpectedGoals =
    LEAGUE_GOALS_PER_TEAM * (strength?.attackStrength ?? 1);
  const teamBaselineExpectedGoalsConceded =
    LEAGUE_GOALS_PER_TEAM * (strength?.defenceWeakness ?? 1);

  // Workload is a minutes effect, so it is applied per Gameweek before the
  // scoring components are evaluated.
  const identity = {
    fullName: `${String(player.first_name ?? "")} ${String(player.second_name ?? "")}`.trim(),
    webName: String(player.web_name ?? ""),
    club: teams.get(teamId) ?? "",
    clubName: context?.teamNamesById?.get(teamId),
  };
  const impact = workloadImpact(identity, nextEvent, context?.workload);
  const expectedMinutes = impact ? applyWorkload(baseMinutes, impact) : baseMinutes;

  // A stored match forecast from the trained team model is a better estimate
  // than the squad-derived one, so it takes precedence where it exists. Its
  // clean-sheet probability is the zero-goal mass of the same Poisson, so the
  // implied goals against invert exactly.
  const fixtureExpectations = upcoming.map((fixture): FixtureExpectation => {
    if (
      fixture.teamExpectedGoals !== undefined
      && fixture.cleanSheetProbability !== undefined
    ) {
      return {
        expectedGoalsFor: fixture.teamExpectedGoals,
        expectedGoalsAgainst: -Math.log(clamp(fixture.cleanSheetProbability, 0.005, 0.995)),
        cleanSheetProbability: fixture.cleanSheetProbability,
      };
    }
    return expectFixture(
      teamStrengths,
      teamId,
      fixture.opponentId,
      fixture.venue === "H",
      fixture.difficulty,
    );
  });

  const breakdowns = upcoming.map((fixture, index) => {
    const gameweekMinutes = index === 0
      ? expectedMinutes
      : (() => {
          const laterImpact = workloadImpact(identity, fixture.event, context?.workload);
          return laterImpact ? applyWorkload(baseMinutes, laterImpact) : baseMinutes;
        })();
    return projectFixturePoints(
      position,
      rates,
      gameweekMinutes,
      fixtureExpectations[index],
      teamBaselineExpectedGoals,
      teamBaselineExpectedGoalsConceded,
      scoring,
    );
  });

  const fixturePoints = breakdowns.map((breakdown) => round(breakdown.total));
  const simulatedByFixture = new Map(
    (pointsForecasts ?? []).map((forecast) => [forecast.fixtureId, forecast]),
  );
  const simulatedPoints = upcoming.map((fixture) =>
    simulatedByFixture.get(fixture.fixtureId)?.expectedPoints,
  );
  const usesSimulation = simulatedPoints.some((score) => score !== undefined);
  const blendedPoints = fixturePoints.map((score, index) => simulatedPoints[index] ?? score);
  const xp1 = round(blendedPoints[0] ?? 0);
  const xp3 = round(blendedPoints.reduce((sum, score) => sum + score, 0));
  const firstFixture = upcoming[0];
  const firstExpectation = fixtureExpectations[0];
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
    teamExpectedGoals: firstFixture?.teamExpectedGoals ?? firstExpectation?.expectedGoalsFor,
    teamExpectedGoalsConceded: firstExpectation?.expectedGoalsAgainst,
    cleanSheetProbability:
      firstFixture?.cleanSheetProbability ?? firstExpectation?.cleanSheetProbability,
    pointsDistribution: firstFixture
      ? simulatedByFixture.get(firstFixture.fixtureId)
      : undefined,
    pointsBreakdown: breakdowns[0],
    rates: {
      expectedGoals: Number(rates.expectedGoals.toFixed(3)),
      expectedAssists: Number(rates.expectedAssists.toFixed(3)),
      defensiveActions: Number(rates.defensiveActions.toFixed(2)),
      observationWeight: rates.observationWeight,
    },
  };
}

/**
 * Scores each team's upcoming run using the same expected goals that drive
 * player projections, so the fixture ticker and the projections cannot
 * disagree.
 */
export function buildTeamOutlook(
  teams: Map<number, string>,
  fixtures: FplFixture[],
  nextEvent: number,
  context: ProjectionContext,
  horizon = 3,
): TeamOutlook[] {
  const outlook: TeamOutlook[] = [];

  for (const [teamId, shortName] of teams) {
    const upcoming = fixtures
      .filter((fixture) => !fixture.finished && fixture.event !== null && fixture.event >= nextEvent)
      .filter((fixture) => fixture.team_h === teamId || fixture.team_a === teamId)
      .sort((a, b) => numeric(a.event) - numeric(b.event))
      .slice(0, horizon);
    if (!upcoming.length) continue;

    const scored = upcoming.map((fixture) => {
      const home = fixture.team_h === teamId;
      const opponentId = home ? fixture.team_a : fixture.team_h;
      const difficulty = home ? fixture.team_h_difficulty : fixture.team_a_difficulty;
      const expectation = expectFixture(
        context.teamStrengths,
        teamId,
        opponentId,
        home,
        difficulty,
      );
      return {
        fixture: {
          opponent: teams.get(opponentId) || "TBC",
          venue: home ? ("H" as const) : ("A" as const),
          difficulty,
          expectedGoalsFor: Number(expectation.expectedGoalsFor.toFixed(2)),
          expectedGoalsAgainst: Number(expectation.expectedGoalsAgainst.toFixed(2)),
        },
        cleanSheetProbability: expectation.cleanSheetProbability,
      };
    });

    const meanFor =
      scored.reduce((sum, entry) => sum + entry.fixture.expectedGoalsFor, 0) / scored.length;
    const meanCleanSheet =
      scored.reduce((sum, entry) => sum + entry.cleanSheetProbability, 0) / scored.length;

    // Map onto 0-100 against plausible per-fixture bounds so the score reads
    // like a rating rather than a raw expectation.
    const attackScore = Math.round(clamp((meanFor / 2.6) * 100, 0, 100));
    const defenceScore = Math.round(clamp((meanCleanSheet / 0.55) * 100, 0, 100));

    outlook.push({
      team: shortName,
      fixtures: scored.map((entry) => entry.fixture),
      attackScore,
      defenceScore,
      overallScore: Math.round(attackScore * 0.55 + defenceScore * 0.45),
    });
  }

  return outlook.sort((a, b) => b.overallScore - a.overallScore);
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
