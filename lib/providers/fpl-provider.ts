import type { FplElement, FplFixture, Team } from "../fpl-model";
import type {
  BacktestSummary,
  ExpectedMinutesProjection,
  MatchForecastProjection,
  PlayerPointsProjection,
  ProjectionProvenance,
} from "../contracts/fpl";
import type { RawScoringConfig } from "../scoring-rules.ts";

const BOOTSTRAP_URL = "https://fantasy.premierleague.com/api/bootstrap-static/";
const FIXTURES_URL = "https://fantasy.premierleague.com/api/fixtures/";

export type FplEvent = {
  id: number;
  is_next: boolean;
  finished: boolean;
};

export type FplSourceSnapshot = {
  elements: FplElement[];
  teams: Team[];
  events: FplEvent[];
  fixtures: FplFixture[];
  /** Live per-event point values from `game_config.scoring`, when published. */
  scoringConfig?: RawScoringConfig | null;
  provenance: ProjectionProvenance;
  expectedMinutesByPlayer?: Map<number, ExpectedMinutesProjection>;
  backtest?: BacktestSummary;
  matchForecastsByFixture?: Map<number, MatchForecastProjection>;
  pointsForecastsByPlayer?: Map<number, PlayerPointsProjection[]>;
};

export interface FplDataProvider {
  loadCurrentSnapshot(): Promise<FplSourceSnapshot>;
}

type BootstrapPayload = {
  elements: FplElement[];
  teams: Team[];
  events: FplEvent[];
  game_config?: { scoring?: RawScoringConfig } | null;
};

type StoredSnapshotExport = {
  provenance: ProjectionProvenance;
  bootstrap: BootstrapPayload;
  fixtures: FplFixture[];
};

type StoredExpectedMinutesForecast = {
  player_source_id: number;
  start_probability: number;
  substitute_probability: number;
  zero_minutes_probability: number;
  expected_minutes_if_start: number;
  expected_minutes_if_substitute: number;
  expected_minutes: number;
  sixty_minute_probability: number;
  early_substitution_probability: number;
  confidence: number;
  features?: Record<string, unknown>;
  reasons: string[];
};

type StoredBacktestReport = {
  verdict: BacktestSummary["verdict"];
  aggregate_metrics: { minutes_mae: number; state_brier_score: number };
  baseline_metrics: { minutes_mae: number; state_brier_score: number };
  sample_count: number;
  fold_metrics: unknown[];
  status: BacktestSummary["status"];
};

type StoredMatchForecast = {
  fixture_source_id: number;
  home_team: string;
  away_team: string;
  expected_home_goals: number;
  expected_away_goals: number;
  home_win_probability: number;
  draw_probability: number;
  away_win_probability: number;
  home_clean_sheet_probability: number;
  away_clean_sheet_probability: number;
  both_teams_score_probability: number;
  over_two_five_probability: number;
  confidence: number;
};

type StoredPlayerPointsForecast = {
  fixture_source_id: number;
  event: number;
  player_source_id: number;
  model_version: PlayerPointsProjection["modelVersion"];
  rules_version: PlayerPointsProjection["rulesVersion"];
  simulation_count: number;
  expected_points: number;
  median_points: number;
  p10_points: number;
  p90_points: number;
  two_plus_probability: number;
  five_plus_probability: number;
  ten_plus_probability: number;
  fifteen_plus_probability: number;
  goal_probability: number;
  assist_probability: number;
  clean_sheet_probability: number;
  bonus_probability: number;
  defensive_contribution_probability: number;
  expected_bonus: number;
  expected_defensive_contribution_points: number;
  confidence: number;
  lineage?: {
    eventModelVersion?: PlayerPointsProjection["eventModelVersion"] | null;
  };
  reasons: string[];
};

async function checksum(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchJson<T>(url: string): Promise<{ data: T; raw: string }> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "NinetyPlus/3.0" },
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`FPL provider returned ${response.status}`);
  const raw = await response.text();
  return { data: JSON.parse(raw) as T, raw };
}

export class OfficialFplProvider implements FplDataProvider {
  async loadCurrentSnapshot(): Promise<FplSourceSnapshot> {
    const retrievedAt = new Date().toISOString();
    const [bootstrapResult, fixtureResult] = await Promise.all([
      fetchJson<BootstrapPayload>(BOOTSTRAP_URL),
      fetchJson<FplFixture[]>(FIXTURES_URL),
    ]);
    const nextEvent =
      bootstrapResult.data.events.find((event) => event.is_next)?.id ??
      bootstrapResult.data.events.find((event) => !event.finished)?.id ??
      1;

    return {
      ...bootstrapResult.data,
      fixtures: fixtureResult.data,
      scoringConfig: bootstrapResult.data.game_config?.scoring ?? null,
      provenance: {
        source: "Fantasy Premier League public web data",
        retrievedAt,
        checksum: await checksum(`${bootstrapResult.raw}\n${fixtureResult.raw}`),
        schemaVersion: "official-fpl-v1",
        season: "2026/27",
        gameweek: nextEvent,
        requestUrls: [BOOTSTRAP_URL, FIXTURES_URL],
      },
    };
  }
}

export class StoredFplProvider implements FplDataProvider {
  private readonly dataApiUrl: string;

  constructor(dataApiUrl: string) {
    this.dataApiUrl = dataApiUrl;
  }

  async loadCurrentSnapshot(): Promise<FplSourceSnapshot> {
    const root = this.dataApiUrl.replace(/\/$/, "");
    const [response, predictionResponse, backtestResponse, matchResponse, pointsResponse] =
      await Promise.all([
      fetch(`${root}/v1/snapshots/latest/export`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      }),
      fetch(`${root}/v1/predictions/expected-minutes/latest`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      }),
      fetch(`${root}/v1/backtests/expected-minutes/latest`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      }),
      fetch(`${root}/v1/predictions/matches/latest`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      }),
      fetch(`${root}/v1/predictions/player-points/latest`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      }),
    ]);
    if (!response.ok) {
      throw new Error(`Stored FPL provider returned ${response.status}`);
    }
    const snapshot = (await response.json()) as StoredSnapshotExport;
    const forecasts = predictionResponse.ok
      ? ((await predictionResponse.json()) as StoredExpectedMinutesForecast[])
      : [];
    const storedBacktest = backtestResponse.ok
      ? ((await backtestResponse.json()) as StoredBacktestReport)
      : undefined;
    const storedMatches = matchResponse.ok
      ? ((await matchResponse.json()) as StoredMatchForecast[])
      : [];
    const storedPoints = pointsResponse.ok
      ? ((await pointsResponse.json()) as StoredPlayerPointsForecast[])
      : [];
    const expectedMinutesByPlayer = new Map(
      forecasts.map((forecast) => {
        const startProbability = Math.round(forecast.start_probability * 100);
        const substituteProbability = Math.round(forecast.substitute_probability * 100);
        return [
          forecast.player_source_id,
          {
            expectedMinutes: Number(forecast.expected_minutes.toFixed(1)),
            startProbability,
            substituteProbability,
            zeroMinutesProbability: Math.max(0, 100 - startProbability - substituteProbability),
            sixtyMinuteProbability: Math.round(forecast.sixty_minute_probability * 100),
            expectedMinutesIfStart: Number(forecast.expected_minutes_if_start.toFixed(1)),
            expectedMinutesIfSubstitute: Number(
              forecast.expected_minutes_if_substitute.toFixed(1),
            ),
            earlySubstitutionProbability: Math.round(
              forecast.early_substitution_probability * 100,
            ),
            confidence: Math.round(forecast.confidence * 100),
            reasons: forecast.reasons,
            modelVersion: forecast.features?.team_lineup_applied
              ? "expected-minutes-team-lineup-v1" as const
              : forecast.features?.team_opportunity_applied
                ? "expected-minutes-team-opportunity-v1" as const
                : "expected-minutes-v2-linear-1" as const,
          },
        ];
      }),
    );
    const matchForecastsByFixture = new Map(
      storedMatches.map((forecast) => [
        forecast.fixture_source_id,
        {
          fixtureId: forecast.fixture_source_id,
          homeTeam: forecast.home_team,
          awayTeam: forecast.away_team,
          expectedHomeGoals: forecast.expected_home_goals,
          expectedAwayGoals: forecast.expected_away_goals,
          homeWinProbability: forecast.home_win_probability,
          drawProbability: forecast.draw_probability,
          awayWinProbability: forecast.away_win_probability,
          homeCleanSheetProbability: forecast.home_clean_sheet_probability,
          awayCleanSheetProbability: forecast.away_clean_sheet_probability,
          bothTeamsScoreProbability: forecast.both_teams_score_probability,
          overTwoFiveProbability: forecast.over_two_five_probability,
          confidence: forecast.confidence,
          modelVersion: "time-decayed-poisson-v1" as const,
        },
      ]),
    );
    const pointsForecastsByPlayer = new Map<number, PlayerPointsProjection[]>();
    for (const forecast of storedPoints) {
      const projections = pointsForecastsByPlayer.get(forecast.player_source_id) ?? [];
      projections.push({
        fixtureId: forecast.fixture_source_id,
        event: forecast.event,
        expectedPoints: forecast.expected_points,
        medianPoints: forecast.median_points,
        p10Points: forecast.p10_points,
        p90Points: forecast.p90_points,
        twoPlusProbability: forecast.two_plus_probability,
        fivePlusProbability: forecast.five_plus_probability,
        tenPlusProbability: forecast.ten_plus_probability,
        fifteenPlusProbability: forecast.fifteen_plus_probability,
        goalProbability: forecast.goal_probability,
        assistProbability: forecast.assist_probability,
        cleanSheetProbability: forecast.clean_sheet_probability,
        bonusProbability: forecast.bonus_probability,
        defensiveContributionProbability: forecast.defensive_contribution_probability,
        expectedBonus: forecast.expected_bonus,
        expectedDefensiveContributionPoints:
          forecast.expected_defensive_contribution_points,
        confidence: forecast.confidence,
        modelVersion: forecast.model_version,
        rulesVersion: forecast.rules_version,
        simulationCount: forecast.simulation_count,
        eventModelVersion: forecast.lineage?.eventModelVersion ?? undefined,
        reasons: forecast.reasons,
      });
      pointsForecastsByPlayer.set(
        forecast.player_source_id,
        projections.sort((a, b) => a.event - b.event),
      );
    }
    return {
      ...snapshot.bootstrap,
      fixtures: snapshot.fixtures,
      scoringConfig: snapshot.bootstrap.game_config?.scoring ?? null,
      provenance: snapshot.provenance,
      expectedMinutesByPlayer,
      backtest: storedBacktest
        ? {
            verdict: storedBacktest.verdict,
            modelMinutesMae: storedBacktest.aggregate_metrics.minutes_mae,
            baselineMinutesMae: storedBacktest.baseline_metrics.minutes_mae,
            modelBrierScore: storedBacktest.aggregate_metrics.state_brier_score,
            baselineBrierScore: storedBacktest.baseline_metrics.state_brier_score,
            sampleCount: storedBacktest.sample_count,
            foldCount: storedBacktest.fold_metrics.length,
            status: storedBacktest.status,
          }
        : undefined,
      matchForecastsByFixture,
      pointsForecastsByPlayer,
    };
  }
}
