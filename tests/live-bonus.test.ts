import assert from "node:assert/strict";
import test from "node:test";
import type { LivePlayerPoints } from "../lib/contracts/live.ts";
import { bonusForFixture, provisionalBonus } from "../lib/live-bonus.ts";
import type { LiveFixture } from "../lib/providers/live-provider.ts";

function player(
  playerId: number,
  bps: number,
  overrides: Partial<LivePlayerPoints> = {},
): LivePlayerPoints {
  return {
    playerId,
    points: 2,
    minutes: 90,
    played: true,
    bps,
    bonus: 0,
    fixtures: [1],
    ...overrides,
  };
}

const started: LiveFixture[] = [
  { id: 1, homeTeam: 1, awayTeam: 2, started: true, finished: false, finishedProvisional: true, kickoff: null },
];

test("the top three in the bonus points system take three, two and one", () => {
  const awarded = bonusForFixture([
    { playerId: 1, bps: 40 },
    { playerId: 2, bps: 33 },
    { playerId: 3, bps: 29 },
    { playerId: 4, bps: 20 },
  ]);
  assert.deepEqual([...awarded], [[1, 3], [2, 2], [3, 1]]);
});

test("two level at the top take three each and the next takes one", () => {
  const awarded = bonusForFixture([
    { playerId: 1, bps: 40 },
    { playerId: 2, bps: 40 },
    { playerId: 3, bps: 29 },
    { playerId: 4, bps: 25 },
  ]);
  assert.deepEqual([...awarded].sort(), [[1, 3], [2, 3], [3, 1]].sort());
});

test("three level at the top take three each and nobody else scores", () => {
  const awarded = bonusForFixture([
    { playerId: 1, bps: 40 },
    { playerId: 2, bps: 40 },
    { playerId: 3, bps: 40 },
    { playerId: 4, bps: 39 },
  ]);
  assert.equal(awarded.size, 3);
  assert.equal(awarded.get(4), undefined);
});

test("two level in second take two each and nobody takes one", () => {
  const awarded = bonusForFixture([
    { playerId: 1, bps: 40 },
    { playerId: 2, bps: 30 },
    { playerId: 3, bps: 30 },
    { playerId: 4, bps: 20 },
  ]);
  assert.deepEqual([...awarded].sort(), [[1, 3], [2, 2], [3, 2]].sort());
});

test("a player on no bonus points cannot take bonus", () => {
  const awarded = bonusForFixture([
    { playerId: 1, bps: 12 },
    { playerId: 2, bps: 0 },
  ]);
  assert.deepEqual([...awarded], [[1, 3]]);
});

test("a match whose bonus is already credited is left alone", () => {
  // One player carries confirmed bonus, so the three points are already
  // inside everyone's totals and must not be added twice.
  const players = [player(1, 40, { bonus: 3, points: 11 }), player(2, 33), player(3, 29)];
  assert.equal(provisionalBonus(players, started).size, 0);
});

test("a match that has not kicked off awards nothing", () => {
  const pending: LiveFixture[] = [
    { id: 1, homeTeam: 1, awayTeam: 2, started: false, finished: false, finishedProvisional: false, kickoff: null },
  ];
  assert.equal(provisionalBonus([player(1, 40), player(2, 20)], pending).size, 0);
});

test("bonus is counted per match, so a double gameweek can earn twice", () => {
  const second: LiveFixture[] = [
    ...started,
    { id: 2, homeTeam: 1, awayTeam: 3, started: true, finished: false, finishedProvisional: true, kickoff: null },
  ];
  const players = [
    player(1, 40, { fixtures: [1, 2] }),
    player(2, 20, { fixtures: [1] }),
    player(3, 20, { fixtures: [2] }),
  ];
  const awarded = provisionalBonus(players, second);
  assert.equal(awarded.get(1), 6);
  assert.equal(awarded.get(2), 2);
});
