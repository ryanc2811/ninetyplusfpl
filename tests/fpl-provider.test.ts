import assert from "node:assert/strict";
import test from "node:test";

import { StoredFplProvider } from "../lib/providers/fpl-provider.ts";

test("stored provider replays snapshot data and provenance", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedUrl = String(input);
    if (requestedUrl.endsWith("/v1/predictions/expected-minutes/latest")) {
      return Response.json([
        {
          player_source_id: 1,
          start_probability: 0.72,
          substitute_probability: 0.18,
          zero_minutes_probability: 0.1,
          expected_minutes_if_start: 78,
          expected_minutes_if_substitute: 16,
          expected_minutes: 59,
          sixty_minute_probability: 0.61,
          early_substitution_probability: 0.11,
          confidence: 0.8,
          features: { team_lineup_applied: true, team_lineup_formation: "4-3-3" },
          reasons: ["five prior matches"],
        },
      ]);
    }
    if (requestedUrl.endsWith("/v1/backtests/expected-minutes/latest")) {
      return Response.json({
        verdict: "beats-baseline",
        aggregate_metrics: { minutes_mae: 12.4, state_brier_score: 0.31 },
        baseline_metrics: { minutes_mae: 15.8, state_brier_score: 0.4 },
        sample_count: 120,
        fold_metrics: [{ test_gameweek: 10 }, { test_gameweek: 11 }],
        status: "experimental",
      });
    }
    if (requestedUrl.endsWith("/v1/predictions/matches/latest")) {
      return Response.json([
        {
          fixture_source_id: 1,
          home_team: "NTH",
          away_team: "STH",
          expected_home_goals: 1.8,
          expected_away_goals: 0.9,
          home_win_probability: 0.58,
          draw_probability: 0.25,
          away_win_probability: 0.17,
          home_clean_sheet_probability: 0.41,
          away_clean_sheet_probability: 0.17,
          both_teams_score_probability: 0.5,
          over_two_five_probability: 0.52,
          confidence: 0.72,
        },
      ]);
    }
    if (requestedUrl.endsWith("/v1/predictions/player-points/latest")) {
      return Response.json([
        {
          fixture_source_id: 1,
          event: 1,
          player_source_id: 1,
          model_version: "correlated-player-points-monte-carlo-v1",
          rules_version: "fpl-2026-27-v1",
          simulation_count: 2000,
          expected_points: 6.2,
          median_points: 5,
          p10_points: 2,
          p90_points: 12,
          two_plus_probability: 0.9,
          five_plus_probability: 0.55,
          ten_plus_probability: 0.18,
          fifteen_plus_probability: 0.04,
          goal_probability: 0.36,
          assist_probability: 0.24,
          clean_sheet_probability: 0.1,
          bonus_probability: 0.31,
          defensive_contribution_probability: 0.08,
          expected_bonus: 0.6,
          expected_defensive_contribution_points: 0.16,
          confidence: 0.78,
          lineage: {
            eventModelVersion: "shrunk-player-position-poisson-v1",
          },
          reasons: ["correlated match simulation"],
        },
      ]);
    }
    return Response.json({
      snapshot_id: "snapshot-1",
      provenance: {
        source: "Fantasy Premier League public web data",
        retrievedAt: "2026-07-29T08:13:04Z",
        checksum: "abc123",
        schemaVersion: "official-fpl-v1",
        season: "2026/27",
        gameweek: 1,
        requestUrls: ["https://fantasy.premierleague.com/api/bootstrap-static/"],
      },
      bootstrap: {
        elements: [{ id: 1 }],
        teams: [{ id: 1, short_name: "NTH" }],
        events: [{ id: 1, is_next: true, finished: false }],
      },
      fixtures: [{ id: 1 }],
    });
  }) as typeof fetch;

  try {
    const snapshot = await new StoredFplProvider("http://127.0.0.1:8000/").loadCurrentSnapshot();
    assert.equal(
      requestedUrl,
      "http://127.0.0.1:8000/v1/predictions/player-points/latest",
    );
    assert.equal(snapshot.elements.length, 1);
    assert.equal(snapshot.fixtures.length, 1);
    assert.equal(snapshot.provenance.checksum, "abc123");
    assert.equal(snapshot.expectedMinutesByPlayer?.get(1)?.expectedMinutes, 59);
    assert.equal(
      snapshot.expectedMinutesByPlayer?.get(1)?.modelVersion,
      "expected-minutes-team-lineup-v1",
    );
    assert.equal(snapshot.backtest?.verdict, "beats-baseline");
    assert.equal(snapshot.backtest?.foldCount, 2);
    assert.equal(snapshot.matchForecastsByFixture?.get(1)?.expectedHomeGoals, 1.8);
    assert.equal(snapshot.pointsForecastsByPlayer?.get(1)?.[0].expectedPoints, 6.2);
    assert.equal(snapshot.pointsForecastsByPlayer?.get(1)?.[0].bonusProbability, 0.31);
    assert.equal(
      snapshot.pointsForecastsByPlayer?.get(1)?.[0].eventModelVersion,
      "shrunk-player-position-poisson-v1",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
