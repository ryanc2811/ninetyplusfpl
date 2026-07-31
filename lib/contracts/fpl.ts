export type Position = "GK" | "DEF" | "MID" | "FWD";
export type RiskLevel = "Low" | "Medium" | "High";

export type ExpectedMinutesProjection = {
  expectedMinutes: number;
  startProbability: number;
  substituteProbability: number;
  zeroMinutesProbability: number;
  sixtyMinuteProbability: number;
  expectedMinutesIfStart: number;
  expectedMinutesIfSubstitute: number;
  earlySubstitutionProbability: number;
  confidence: number;
  reasons: string[];
  modelVersion:
    | "expected-minutes-baseline-v1"
    | "expected-minutes-v2-linear-1"
    | "expected-minutes-team-opportunity-v1"
    | "expected-minutes-team-lineup-v1"
    | "expected-minutes-workload-v1";
};

/**
 * Expected points decomposed into the FPL scoring events that produce them.
 * Components sum to `total` and are each expressed in points, so the UI can
 * show a manager exactly where a projection comes from.
 */
export type PointsBreakdown = {
  appearance: number;
  goals: number;
  assists: number;
  cleanSheet: number;
  goalsConceded: number;
  saves: number;
  defensiveContribution: number;
  bonus: number;
  cards: number;
  total: number;
};

export type PlayerProjection = {
  id: number;
  name: string;
  team: string;
  opponent: string;
  venue: "H" | "A";
  position: Position;
  price: number;
  xp1: number;
  xp3: number;
  form: number;
  minutes: number;
  ownership: number;
  risk: RiskLevel;
  trend: number;
  confidence: number;
  fixtures: string[];
  breakdown: number[];
  expectedMinutes: ExpectedMinutesProjection;
  teamExpectedGoals?: number;
  teamExpectedGoalsConceded?: number;
  cleanSheetProbability?: number;
  pointsDistribution?: PlayerPointsProjection;
  /** Component decomposition of the next-Gameweek projection. */
  pointsBreakdown?: PointsBreakdown;
  /** Per-90 rates behind the projection, after shrinkage. */
  rates?: {
    expectedGoals: number;
    expectedAssists: number;
    defensiveActions: number;
    observationWeight: number;
  };
};

export type PlayerPointsProjection = {
  fixtureId: number;
  event: number;
  expectedPoints: number;
  medianPoints: number;
  p10Points: number;
  p90Points: number;
  twoPlusProbability: number;
  fivePlusProbability: number;
  tenPlusProbability: number;
  fifteenPlusProbability: number;
  goalProbability: number;
  assistProbability: number;
  cleanSheetProbability: number;
  bonusProbability: number;
  defensiveContributionProbability: number;
  expectedBonus: number;
  expectedDefensiveContributionPoints: number;
  confidence: number;
  modelVersion: "correlated-player-points-monte-carlo-v1";
  rulesVersion: "fpl-2026-27-v1";
  simulationCount: number;
  eventModelVersion?: "shrunk-player-position-poisson-v1";
  reasons: string[];
};

export type MatchForecastProjection = {
  fixtureId: number;
  homeTeam: string;
  awayTeam: string;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  homeWinProbability: number;
  drawProbability: number;
  awayWinProbability: number;
  homeCleanSheetProbability: number;
  awayCleanSheetProbability: number;
  bothTeamsScoreProbability: number;
  overTwoFiveProbability: number;
  confidence: number;
  modelVersion: "time-decayed-poisson-v1";
};

/** A team's upcoming run, scored by the same model that drives projections. */
export type TeamOutlook = {
  team: string;
  fixtures: Array<{
    opponent: string;
    venue: "H" | "A";
    difficulty: number;
    expectedGoalsFor: number;
    expectedGoalsAgainst: number;
  }>;
  /** 0-100 composite of attacking and defensive expectation over the run. */
  attackScore: number;
  defenceScore: number;
  overallScore: number;
};

export type DataQualitySummary = {
  valid: boolean;
  issues: string[];
  playerCount: number;
  fixtureCount: number;
  teamsCovered: number;
};

export type ProjectionProvenance = {
  source: string;
  retrievedAt: string;
  checksum: string;
  schemaVersion: string;
  season: string;
  gameweek: number;
  requestUrls: string[];
};

export type BacktestSummary = {
  verdict: "beats-baseline" | "does-not-beat-baseline";
  modelMinutesMae: number;
  baselineMinutesMae: number;
  modelBrierScore: number;
  baselineBrierScore: number;
  sampleCount: number;
  foldCount: number;
  status: "experimental";
};

export type FplProjectionResponse = {
  players: PlayerProjection[];
  source: "official-fpl";
  model: {
    version: "component-xp-v1";
    baseline: true;
    horizon: 3;
    playerCount: number;
    features: string[];
    expectedMinutesVersion: ExpectedMinutesProjection["modelVersion"];
    /** Where the per-event point values came from. */
    scoringRulesVersion?: string;
    scoringRulesSource?: "live-game-config" | "static-fallback";
    rateModelVersion?: string;
    teamStrengthVersion?: string;
    workloadVersion?: string;
    workloadAdjustedCount?: number;
    teamOpportunityAdjustedCount?: number;
    teamLineupAdjustedCount?: number;
    backtest?: BacktestSummary;
    teamModelVersion?: MatchForecastProjection["modelVersion"];
    pointsModelVersion?: PlayerPointsProjection["modelVersion"];
    rulesVersion?: PlayerPointsProjection["rulesVersion"];
    simulationCount?: number;
    eventModelVersion?: PlayerPointsProjection["eventModelVersion"];
  };
  nextEvent: number;
  /** ISO deadline for `nextEvent`, straight from the official event feed. */
  nextDeadline: string | null;
  teamOutlook: TeamOutlook[];
  updatedAt: string;
  provenance: ProjectionProvenance;
  dataQuality: DataQualitySummary;
};
