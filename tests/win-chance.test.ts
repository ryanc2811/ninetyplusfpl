import assert from "node:assert/strict";
import test from "node:test";
import { winChance, type WinChanceManager } from "../lib/win-chance.ts";

function manager(overrides: Partial<WinChanceManager> & { entryId: number; points: number }): WinChanceManager {
  return {
    remaining: [],
    futureGameweeks: 0,
    meanGameweek: 50,
    gameweekSd: 12,
    ...overrides,
  };
}

test("a month with nothing left to play is already decided", () => {
  const chances = winChance([
    manager({ entryId: 1, points: 230 }),
    manager({ entryId: 2, points: 219 }),
  ]);
  assert.equal(chances.get(1), 1);
  assert.equal(chances.get(2), 0);
});

test("managers level with nothing left share the month", () => {
  const chances = winChance([
    manager({ entryId: 1, points: 200 }),
    manager({ entryId: 2, points: 200 }),
  ]);
  assert.equal(chances.get(1), 0.5);
  assert.equal(chances.get(2), 0.5);
});

test("a lead too big for the players left is not in danger", () => {
  const chances = winChance([
    manager({ entryId: 1, points: 300 }),
    manager({ entryId: 2, points: 200, remaining: [{ expected: 6, multiplier: 2 }] }),
  ]);
  assert.equal(chances.get(1), 1);
});

test("a captain still to play can overturn a small lead", () => {
  const chances = winChance([
    manager({ entryId: 1, points: 210 }),
    manager({ entryId: 2, points: 203, remaining: [{ expected: 7, multiplier: 2, p10: 2, median: 6, p90: 15 }] }),
  ]);
  const chaser = chances.get(2)!;
  assert.ok(chaser > 0.2 && chaser < 0.95, `expected a real chance, got ${chaser}`);
  assert.ok(Math.abs(chances.get(1)! + chaser - 1) < 1e-9);
});

test("more players left means more uncertainty, not more points", () => {
  const few = winChance([
    manager({ entryId: 1, points: 210 }),
    manager({ entryId: 2, points: 205, remaining: [{ expected: 4, multiplier: 1, p10: 1, median: 3, p90: 9 }] }),
  ]);
  const many = winChance([
    manager({ entryId: 1, points: 210 }),
    manager({
      entryId: 2,
      points: 205,
      remaining: Array.from({ length: 5 }, () => ({ expected: 4, multiplier: 1, p10: 1, median: 3, p90: 9 })),
    }),
  ]);
  assert.ok(many.get(2)! > few.get(2)!);
});

test("the chances across a league add up to one", () => {
  const chances = winChance([
    manager({ entryId: 1, points: 230, remaining: [{ expected: 5, multiplier: 2 }] }),
    manager({ entryId: 2, points: 228, remaining: [{ expected: 4, multiplier: 1 }] }),
    manager({ entryId: 3, points: 225, remaining: [{ expected: 6, multiplier: 1 }] }),
    manager({ entryId: 4, points: 180, remaining: [] }),
  ]);
  const total = [...chances.values()].reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `chances summed to ${total}`);
  assert.equal(chances.get(4), 0);
});

test("whole gameweeks still to come widen the race", () => {
  const lastWeek = winChance([
    manager({ entryId: 1, points: 160 }),
    manager({ entryId: 2, points: 140 }),
  ]);
  const twoLeft = winChance([
    manager({ entryId: 1, points: 160, futureGameweeks: 2 }),
    manager({ entryId: 2, points: 140, futureGameweeks: 2 }),
  ]);
  assert.equal(lastWeek.get(2), 0);
  assert.ok(twoLeft.get(2)! > 0.1);
});

test("the same inputs always give the same number", () => {
  const squad = [
    manager({ entryId: 1, points: 210, remaining: [{ expected: 6, multiplier: 2 }] }),
    manager({ entryId: 2, points: 208, remaining: [{ expected: 5, multiplier: 1 }] }),
  ];
  assert.deepEqual([...winChance(squad)], [...winChance(squad)]);
});
