import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { compareToBenchmark, type BenchmarkSet } from "../lib/benchmark.ts";
import {
  expectedBonusPer90,
  FALLBACK_CALIBRATION,
  fitOutputCalibration,
  type CalibrationSource,
} from "../lib/calibration.ts";

// --- benchmarks must not leak into the model -----------------------------

test("no projection module imports benchmark data", async () => {
  const root = new URL("../lib/", import.meta.url);
  const files = await readdir(root, { recursive: true, withFileTypes: true });
  const offenders: string[] = [];

  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith(".ts")) continue;
    if (file.name === "benchmark.ts") continue;
    const path = new URL(`${file.parentPath.split("/lib/")[1] ?? ""}/${file.name}`.replace(/^\//, ""), root);
    const source = await readFile(path, "utf8");
    if (/from\s+["'][^"']*benchmark/.test(source) || /data\/benchmarks/.test(source)) {
      offenders.push(file.name);
    }
  }

  // Fitting projections to a reference source would replace a measurable model
  // with an unmeasurable copy of someone else's.
  assert.deepEqual(offenders, [], `benchmark data must stay evaluation-only: ${offenders.join(", ")}`);
});

test("the benchmark file parses and is internally consistent", async () => {
  const raw = await readFile(new URL("../data/benchmarks/gw1-reference.json", import.meta.url), "utf8");
  const set = JSON.parse(raw) as BenchmarkSet;
  assert.ok(set.source.length > 0);
  assert.ok(Number.isInteger(set.gameweek) && set.gameweek >= 1);
  assert.ok(set.entries.length > 0);
  for (const entry of set.entries) {
    assert.ok(entry.player.length > 0, "every entry needs a player name");
    assert.ok(entry.projected > 0 && entry.projected < 25, `implausible projection for ${entry.player}`);
  }
});

// --- report mechanics ----------------------------------------------------

const benchmark: BenchmarkSet = {
  source: "Test Source",
  gameweek: 1,
  capturedAt: "2026-07-31",
  entries: [
    { player: "Alpha", team: "AAA", projected: 8 },
    { player: "Bravo", team: "BBB", projected: 6 },
    { player: "Charlie", team: "CCC", projected: 3 },
    { player: "Delta", team: "DDD", projected: 2 },
  ],
};

test("a model that matches the reference reports no bias", () => {
  const report = compareToBenchmark(
    [
      { name: "Alpha", team: "AAA", xp1: 8 },
      { name: "Bravo", team: "BBB", xp1: 6 },
      { name: "Charlie", team: "CCC", xp1: 3 },
      { name: "Delta", team: "DDD", xp1: 2 },
    ],
    benchmark,
  );
  assert.equal(report.matched, 4);
  assert.equal(report.bias, 0);
  assert.equal(report.meanAbsoluteError, 0);
  assert.equal(report.biasSlope, 0);
});

test("a constant offset shows as bias with a flat slope", () => {
  const report = compareToBenchmark(
    [
      { name: "Alpha", team: "AAA", xp1: 7 },
      { name: "Bravo", team: "BBB", xp1: 5 },
      { name: "Charlie", team: "CCC", xp1: 2 },
      { name: "Delta", team: "DDD", xp1: 1 },
    ],
    benchmark,
  );
  assert.equal(report.bias, -1);
  assert.equal(report.biasSlope, 0);
});

test("compression at the top end shows as a negative bias slope", () => {
  // This is the failure the harness exists to catch: each projection is 20%
  // low, so the absolute gap grows with the projection.
  const report = compareToBenchmark(
    [
      { name: "Alpha", team: "AAA", xp1: 6.4 },
      { name: "Bravo", team: "BBB", xp1: 4.8 },
      { name: "Charlie", team: "CCC", xp1: 2.4 },
      { name: "Delta", team: "DDD", xp1: 1.6 },
    ],
    benchmark,
  );
  assert.ok(report.bias < 0);
  assert.ok(report.biasSlope < -0.15, `expected a clear negative slope, got ${report.biasSlope}`);
});

test("unmatched reference players are reported, not silently dropped", () => {
  const report = compareToBenchmark([{ name: "Alpha", team: "AAA", xp1: 8 }], benchmark);
  assert.equal(report.matched, 1);
  assert.deepEqual(report.missing, ["Bravo", "Charlie", "Delta"]);
});

// --- calibration ---------------------------------------------------------

function calibrationSource(overrides: Partial<CalibrationSource> = {}): CalibrationSource {
  return {
    minutes: 2700,
    goals_scored: 10,
    assists: 6,
    expected_goals: 10,
    expected_assists: 4,
    bps: 600,
    bonus: 12,
    ...overrides,
  };
}

test("calibration falls back when the sample is too small to fit", () => {
  const fitted = fitOutputCalibration([calibrationSource(), calibrationSource()]);
  assert.equal(fitted.source, "static-fallback");
});

test("calibration recovers the realised-to-expected ratios from a snapshot", () => {
  // 12 goals against 10 xG, and 6 assists against 4 xA.
  const players = Array.from({ length: 60 }, (_, index) =>
    calibrationSource({ goals_scored: 12, bps: 400 + index * 8, bonus: index * 0.3 }),
  );
  const fitted = fitOutputCalibration(players);
  assert.equal(fitted.source, "fitted-from-snapshot");
  assert.ok(Math.abs(fitted.goalsPerExpectedGoal - 1.2) < 0.01);
  assert.ok(Math.abs(fitted.assistsPerExpectedAssist - 1.5) < 0.01);
  assert.equal(fitted.sampleSize, 60);
});

test("the fitted bonus curve is monotone and interpolates between knots", () => {
  const calibration = FALLBACK_CALIBRATION;
  let previous = -1;
  for (let bps = 0; bps <= 45; bps += 2.5) {
    const bonus = expectedBonusPer90(calibration, bps);
    assert.ok(bonus >= previous - 1e-9, `bonus fell at ${bps} BPS/90`);
    previous = bonus;
  }
  // Between the 17.5 and 22.5 knots the curve must sit between their values.
  const middle = expectedBonusPer90(calibration, 20);
  assert.ok(middle > 0.3 && middle < 0.55, `expected interpolation, got ${middle}`);
});

test("bonus is never negative and stays bounded above the fitted range", () => {
  assert.equal(expectedBonusPer90(FALLBACK_CALIBRATION, -5), 0);
  assert.ok(expectedBonusPer90(FALLBACK_CALIBRATION, 200) <= 2.2);
});
