import assert from "node:assert/strict";
import test from "node:test";
import {
  createChipPlan,
  squadStrategyForGameweek,
  validateChipPlan,
} from "../lib/chip-strategy.ts";

test("creates two valid four-chip sets without gameweek collisions", () => {
  const plan = createChipPlan();
  assert.equal(plan.length, 8);
  assert.equal(plan.filter((item) => item.half === 1).length, 4);
  assert.equal(plan.filter((item) => item.half === 2).length, 4);
  assert.equal(validateChipPlan(plan).valid, true);
});

test("a manager-controlled GW1 Bench Boost moves the first Wildcard earlier", () => {
  const plan = createChipPlan({ BB1: 1 });
  const benchBoost = plan.find((item) => item.id === "BB1");
  const wildcard = plan.find((item) => item.id === "WC1");
  assert.equal(benchBoost?.locked, true);
  assert.equal(benchBoost?.gameweek, 1);
  assert.equal(wildcard?.gameweek, 4);
  assert.equal(squadStrategyForGameweek(plan, 1), "bench-boost");
});

test("rejects consecutive cross-half Free Hits", () => {
  const plan = createChipPlan({ FH1: 19, FH2: 20 });
  assert.match(validateChipPlan(plan).issues.join(" "), /consecutive gameweeks/);
});

test("moves an illegal GW1 Free Hit to a legal AI-controlled week", () => {
  const plan = createChipPlan({ FH1: 1 });
  const freeHit = plan.find((item) => item.id === "FH1");
  assert.notEqual(freeHit?.gameweek, 1);
  assert.equal(freeHit?.locked, false);
  assert.equal(validateChipPlan(plan).valid, true);
});

