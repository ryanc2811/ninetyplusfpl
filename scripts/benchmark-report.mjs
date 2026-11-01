/**
 * Prints how this model's projections compare to a reference source.
 *
 *   node --experimental-strip-types scripts/benchmark-report.mjs
 *
 * Reads live FPL data, runs the full projection, and reports bias overall and
 * banded by projection size. The banded view is the point: a model can have
 * near-zero overall bias while being badly wrong at the top of the ranking,
 * which is exactly the failure this harness was built to catch.
 */

import { readFile } from "node:fs/promises";
import { compareToBenchmark, formatBenchmarkReport } from "../lib/benchmark.ts";
import {
  buildProjectionContext,
  projectExpectedMinutesForSquad,
  projectPlayer,
} from "../lib/fpl-model.ts";

const BOOTSTRAP = "https://fantasy.premierleague.com/api/bootstrap-static/";
const FIXTURES = "https://fantasy.premierleague.com/api/fixtures/";

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "NinetyPlus/3.0" },
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

const benchmarkPath = process.argv[2]
  ?? new URL("../data/benchmarks/gw1-reference.json", import.meta.url);

const [benchmark, bootstrap, fixtures] = await Promise.all([
  readFile(benchmarkPath, "utf8").then(JSON.parse),
  fetchJson(BOOTSTRAP),
  fetchJson(FIXTURES),
]);

const teams = new Map(bootstrap.teams.map((team) => [team.id, team.short_name]));
const nextEvent =
  bootstrap.events.find((event) => event.is_next)?.id
  ?? bootstrap.events.find((event) => !event.finished)?.id
  ?? 1;

const expectedMinutes = projectExpectedMinutesForSquad(
  bootstrap.elements,
  nextEvent === 1 ? 38 : nextEvent - 1,
);
const context = buildProjectionContext(
  bootstrap.elements,
  expectedMinutes,
  bootstrap.game_config?.scoring,
);
const projections = bootstrap.elements.map((player) =>
  projectPlayer(
    player,
    fixtures,
    teams,
    nextEvent,
    expectedMinutes.get(Number(player.id)),
    undefined,
    undefined,
    context,
  ),
);

console.log(`Model: component-xp-v1 · calibration ${context.calibration.source}`);
console.log(
  `  goals per xG ${context.calibration.goalsPerExpectedGoal.toFixed(3)}`
  + ` · assists per xA ${context.calibration.assistsPerExpectedAssist.toFixed(3)}`
  + ` · fitted on ${context.calibration.sampleSize} players`,
);
console.log("");
console.log(formatBenchmarkReport(compareToBenchmark(projections, benchmark)));
