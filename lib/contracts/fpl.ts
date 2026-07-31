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
    | "expected-minutes-team-lineup-v1";
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
  cleanSheetProbability?: number;
  pointsDistribution?: PlayerPointsProjection;
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
    version: "fixture-blend-v4";
    baseline: true;
    horizon: 3;
    playerCount: number;
    features: string[];
    expectedMinutesVersion: ExpectedMinutesProjection["modelVersion"];
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
  updatedAt: string;
  provenance: ProjectionProvenance;
  dataQuality: DataQualitySummary;
};
