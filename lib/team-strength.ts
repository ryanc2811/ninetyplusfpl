import { LEAGUE_GOALS_PER_TEAM, type PlayerRates } from "./player-rates.ts";

/**
 * Team attack and defence strength derived from squad data.
 *
 * A team's expected goals in a match is the sum, over the players on the pitch,
 * of each player's expected goals per 90 scaled by the minutes they play. So
 * weighting every squad member's shrunk xG/90 by their expected minutes gives a
 * team attack rate directly, without needing a separate team-level feed.
 *
 * Defence works the other way round: `expected_goals_conceded_per_90` is a team
 * property observed while a given player was on the pitch, so the minutes-
 * weighted mean across a squad approximates the team's own concession rate.
 *
 * Both ratings are normalised to the league average and then shrunk toward 1.0
 * according to how much Premier League football sits behind them. A promoted
 * side with no top-flight minutes lands at league average on the derived
 * signal, which is too generous, so the official fixture-difficulty rating is
 * blended in with a weight that rises exactly as the derived confidence falls.
 */

const HOME_ATTACK_FACTOR = 1.09;
const AWAY_ATTACK_FACTOR = 0.92;

/** Squad minutes at which the derived rating carries half its full weight. */
const CONFIDENCE_MINUTES = 12_000;

/**
 * How freely an opponent of the given official difficulty concedes, and how
 * strongly they attack. Difficulty is expressed from the perspective of the
 * team facing them, so 5 is the hardest opponent.
 */
const DIFFICULTY_DEFENCE_WEAKNESS: Record<number, number> = {
  1: 1.28, 2: 1.13, 3: 1.0, 4: 0.88, 5: 0.77,
};
const DIFFICULTY_ATTACK_STRENGTH: Record<number, number> = {
  1: 0.77, 2: 0.88, 3: 1.0, 4: 1.13, 5: 1.28,
};

export type TeamStrength = {
  teamId: number;
  attackStrength: number;
  defenceWeakness: number;
  squadMinutes: number;
  confidence: number;
};

export type FixtureExpectation = {
  expectedGoalsFor: number;
  expectedGoalsAgainst: number;
  cleanSheetProbability: number;
};

export type SquadMember = {
  playerId: number;
  teamId: number;
  rates: PlayerRates;
  expectedMinutes: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function buildTeamStrengths(squad: SquadMember[]): Map<number, TeamStrength> {
  const attackByTeam = new Map<number, number>();
  const concededWeightedByTeam = new Map<number, number>();
  const expectedMinutesByTeam = new Map<number, number>();
  const observedMinutesByTeam = new Map<number, number>();

  for (const member of squad) {
    const { teamId, rates, expectedMinutes } = member;
    attackByTeam.set(
      teamId,
      (attackByTeam.get(teamId) ?? 0) + rates.expectedGoals * (expectedMinutes / 90),
    );
    concededWeightedByTeam.set(
      teamId,
      (concededWeightedByTeam.get(teamId) ?? 0)
        + rates.expectedGoalsConceded * expectedMinutes,
    );
    expectedMinutesByTeam.set(
      teamId,
      (expectedMinutesByTeam.get(teamId) ?? 0) + expectedMinutes,
    );
    observedMinutesByTeam.set(
      teamId,
      (observedMinutesByTeam.get(teamId) ?? 0) + rates.minutesObserved,
    );
  }

  const teamIds = [...attackByTeam.keys()];
  if (!teamIds.length) return new Map();

  const rawAttack = new Map(teamIds.map((id) => [id, attackByTeam.get(id) ?? 0]));
  const rawDefence = new Map(
    teamIds.map((id) => {
      const minutes = expectedMinutesByTeam.get(id) ?? 0;
      return [
        id,
        minutes > 0 ? (concededWeightedByTeam.get(id) ?? 0) / minutes : LEAGUE_GOALS_PER_TEAM,
      ];
    }),
  );

  const meanAttack =
    [...rawAttack.values()].reduce((sum, value) => sum + value, 0) / teamIds.length;
  const meanDefence =
    [...rawDefence.values()].reduce((sum, value) => sum + value, 0) / teamIds.length;

  const strengths = new Map<number, TeamStrength>();
  for (const teamId of teamIds) {
    const observedMinutes = observedMinutesByTeam.get(teamId) ?? 0;
    const confidence = observedMinutes / (observedMinutes + CONFIDENCE_MINUTES);
    const attackRatio = meanAttack > 0 ? (rawAttack.get(teamId) ?? 0) / meanAttack : 1;
    const defenceRatio = meanDefence > 0 ? (rawDefence.get(teamId) ?? 0) / meanDefence : 1;
    strengths.set(teamId, {
      teamId,
      // Shrink toward league average in proportion to missing evidence.
      attackStrength: clamp(1 + (attackRatio - 1) * confidence, 0.55, 1.75),
      defenceWeakness: clamp(1 + (defenceRatio - 1) * confidence, 0.55, 1.75),
      squadMinutes: observedMinutes,
      confidence: Number(confidence.toFixed(3)),
    });
  }
  return strengths;
}

const NEUTRAL: TeamStrength = {
  teamId: -1,
  attackStrength: 1,
  defenceWeakness: 1,
  squadMinutes: 0,
  confidence: 0,
};

/**
 * Combines the derived rating with the official difficulty rating, giving the
 * official signal more weight the less Premier League evidence a squad has.
 */
function blend(derived: number, official: number, confidence: number) {
  return derived * confidence + official * (1 - confidence);
}

export function expectFixture(
  strengths: Map<number, TeamStrength>,
  teamId: number,
  opponentId: number,
  home: boolean,
  difficultyFaced: number,
): FixtureExpectation {
  const team = strengths.get(teamId) ?? NEUTRAL;
  const opponent = strengths.get(opponentId) ?? NEUTRAL;
  const officialDefenceWeakness = DIFFICULTY_DEFENCE_WEAKNESS[difficultyFaced] ?? 1;
  const officialAttackStrength = DIFFICULTY_ATTACK_STRENGTH[difficultyFaced] ?? 1;

  const opponentDefence = blend(
    opponent.defenceWeakness,
    officialDefenceWeakness,
    opponent.confidence,
  );
  const opponentAttack = blend(
    opponent.attackStrength,
    officialAttackStrength,
    opponent.confidence,
  );

  const expectedGoalsFor = clamp(
    LEAGUE_GOALS_PER_TEAM
      * team.attackStrength
      * opponentDefence
      * (home ? HOME_ATTACK_FACTOR : AWAY_ATTACK_FACTOR),
    0.2,
    4.5,
  );
  const expectedGoalsAgainst = clamp(
    LEAGUE_GOALS_PER_TEAM
      * opponentAttack
      * team.defenceWeakness
      * (home ? AWAY_ATTACK_FACTOR : HOME_ATTACK_FACTOR),
    0.2,
    4.5,
  );

  return {
    expectedGoalsFor,
    expectedGoalsAgainst,
    // Goals against are Poisson, so a clean sheet is the zero-goal mass.
    cleanSheetProbability: Math.exp(-expectedGoalsAgainst),
  };
}

export const TEAM_STRENGTH_MODEL_VERSION = "squad-derived-team-strength-v1";
