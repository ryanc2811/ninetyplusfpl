import assert from "node:assert/strict";
import test from "node:test";
import type { LivePlayerPoints } from "../lib/contracts/live.ts";
import type { MonthlyResult, MonthlyStanding } from "../lib/contracts/leagues.ts";
import {
  effectiveMultipliers,
  liveEntryScore,
  liveManager,
  mergeLiveIntoMonth,
  playersStillToPlay,
} from "../lib/live-standings.ts";
import type { EntryPicks, LiveFixture, LivePlayerMeta } from "../lib/providers/live-provider.ts";
import { parseTeamId } from "../lib/fpl-team-id.ts";

function picks(overrides: Partial<EntryPicks> & { entryId: number }): EntryPicks {
  return {
    event: 10,
    activeChip: null,
    automaticSubs: [],
    points: 0,
    transferCost: 0,
    bank: 0,
    squadValue: 100,
    picks: [],
    ...overrides,
  };
}

function pick(playerId: number, multiplier: number, position = playerId) {
  return {
    playerId,
    position,
    multiplier,
    isCaptain: multiplier >= 2,
    isViceCaptain: false,
  };
}

function live(points: Record<number, number>, minutes: Record<number, number> = {}) {
  return new Map<number, LivePlayerPoints>(
    Object.entries(points).map(([id, value]) => [
      Number(id),
      {
        playerId: Number(id),
        points: value,
        minutes: minutes[Number(id)] ?? 90,
        played: (minutes[Number(id)] ?? 90) > 0,
      },
    ]),
  );
}

function standing(overrides: Partial<MonthlyStanding> & { entryId: number; teamName: string }): MonthlyStanding {
  const gameweeks = overrides.gameweeks ?? [];
  const grossPoints = gameweeks.reduce((sum, week) => sum + week.points, 0);
  const transferCost = gameweeks.reduce((sum, week) => sum + (week.points - week.netPoints), 0);
  return {
    managerName: `Manager ${overrides.entryId}`,
    rank: 0,
    netPoints: grossPoints - transferCost,
    grossPoints,
    transferCost,
    pointsOnBench: 0,
    gameweeksCounted: gameweeks.length,
    previousRank: null,
    ...overrides,
    gameweeks,
  };
}

function month(standings: MonthlyStanding[], overrides: Partial<MonthlyResult["month"]> = {}): MonthlyResult {
  return {
    month: {
      phaseId: 5,
      name: "October",
      startEvent: 9,
      stopEvent: 11,
      complete: false,
      current: true,
      gameweeksPlayed: 1,
      ...overrides,
    },
    standings,
  };
}

// --- a manager's live score ----------------------------------------------

test("only the starting eleven scores, and the captain scores twice", () => {
  const entry = picks({
    entryId: 1,
    picks: [pick(10, 1), pick(11, 2), pick(12, 1), pick(13, 0)],
  });
  const score = liveEntryScore(entry, live({ 10: 6, 11: 9, 12: 2, 13: 14 }));
  // 6 + (9 × 2) + 2, with the 14-point bench player ignored.
  assert.equal(score.points, 26);
});

test("a triple captain multiplies by three", () => {
  const entry = picks({
    entryId: 1,
    activeChip: "3xc",
    picks: [pick(10, 3), pick(11, 1)],
  });
  assert.equal(liveEntryScore(entry, live({ 10: 12, 11: 3 })).points, 39);
});

test("a hit comes off the live score, which is what the month counts", () => {
  const entry = picks({ entryId: 1, transferCost: 8, picks: [pick(10, 1)] });
  const score = liveEntryScore(entry, live({ 10: 50 }));
  assert.equal(score.points, 50);
  assert.equal(score.netPoints, 42);
  assert.equal(score.transferCost, 8);
});

test("an automatic substitution moves the multiplier to the bench player", () => {
  const entry = picks({
    entryId: 1,
    picks: [pick(10, 1), pick(20, 0)],
    automaticSubs: [{ out: 10, in: 20 }],
  });
  const multipliers = effectiveMultipliers(entry);
  assert.equal(multipliers.get(10), 0);
  assert.equal(multipliers.get(20), 1);
  assert.equal(liveEntryScore(entry, live({ 10: 0, 20: 7 })).points, 7);
});

// --- still to play --------------------------------------------------------

const META: LivePlayerMeta[] = [
  { playerId: 10, name: "Salah", team: 1, teamShort: "LIV", position: "MID" },
  { playerId: 11, name: "Haaland", team: 2, teamShort: "MCI", position: "FWD" },
  { playerId: 12, name: "Saka", team: 3, teamShort: "ARS", position: "MID" },
  { playerId: 20, name: "Raya", team: 3, teamShort: "ARS", position: "GK" },
];
const metaById = new Map(META.map((player) => [player.playerId, player]));
const teamShort = new Map(META.map((player) => [player.team, player.teamShort]));

const FIXTURES: LiveFixture[] = [
  { id: 1, homeTeam: 1, awayTeam: 4, started: false, finished: false, finishedProvisional: false, kickoff: "2026-11-07T16:30:00Z" },
  { id: 2, homeTeam: 2, awayTeam: 5, started: true, finished: true, finishedProvisional: true, kickoff: "2026-11-07T12:30:00Z" },
  { id: 3, homeTeam: 3, awayTeam: 6, started: true, finished: false, finishedProvisional: false, kickoff: "2026-11-07T15:00:00Z" },
];

test("players still to play are the starters whose fixture has not finished", () => {
  const entry = picks({
    entryId: 1,
    picks: [pick(10, 2), pick(11, 1), pick(12, 1), pick(20, 0)],
  });
  const toPlay = playersStillToPlay(entry, FIXTURES, metaById, teamShort);
  // Haaland's fixture is over; the benched keeper never counted.
  assert.deepEqual(toPlay.map((player) => player.name), ["Salah", "Saka"]);
  // The captain is listed first, because that is the one that swings a month.
  assert.equal(toPlay[0].multiplier, 2);
  assert.equal(toPlay[0].fixture, "LIV v ?");
});

test("a manager in progress reports both what has played and what has not", () => {
  const entry = picks({
    entryId: 7,
    transferCost: 4,
    picks: [pick(10, 2), pick(11, 1), pick(12, 1)],
  });
  const result = liveManager(
    entry,
    live({ 10: 2, 11: 9, 12: 1 }, { 10: 20, 11: 90, 12: 60 }),
    FIXTURES,
    metaById,
    teamShort,
  );
  assert.equal(result.points, 2 * 2 + 9 + 1);
  assert.equal(result.netPoints, 10);
  assert.equal(result.playersToPlay, 2);
  // Only Haaland's fixture is complete.
  assert.equal(result.playersPlayed, 1);
});

test("a match that has been played is over, even before bonus is confirmed", () => {
  // The official feed leaves `finished` false until bonus is checked, which
  // can be the next day; `finished_provisional` is full time.
  const played: LiveFixture[] = [
    { id: 3, homeTeam: 3, awayTeam: 6, started: true, finished: false, finishedProvisional: true, kickoff: "2026-11-07T15:00:00Z" },
  ];
  const entry = picks({ entryId: 1, picks: [pick(12, 1)] });
  assert.deepEqual(playersStillToPlay(entry, played, metaById, teamShort), []);
});

// --- folding the live gameweek into the month -----------------------------

test("an in-progress gameweek is added to a month that does not have it yet", () => {
  const table = month([
    standing({ entryId: 1, teamName: "Alpha", rank: 1, gameweeks: [{ event: 9, points: 60, netPoints: 60 }] }),
    standing({ entryId: 2, teamName: "Bravo", rank: 2, gameweeks: [{ event: 9, points: 50, netPoints: 50 }] }),
  ]);
  const merged = mergeLiveIntoMonth(
    table,
    new Map([
      [1, { points: 10, netPoints: 10 }],
      [2, { points: 40, netPoints: 40 }],
    ]),
    10,
  );

  // Bravo's live 40 takes them past Alpha, and the arrow knows where they were.
  assert.deepEqual(merged.standings.map((row) => [row.teamName, row.netPoints, row.rank]), [
    ["Bravo", 90, 1],
    ["Alpha", 70, 2],
  ]);
  const bravo = merged.standings[0];
  assert.equal(bravo.rank, 1);
  assert.equal(bravo.previousRank, 2);
  assert.equal(bravo.gameweeksCounted, 2);
});

test("a provisional gameweek already in history is replaced, never counted twice", () => {
  const table = month([
    standing({
      entryId: 1,
      teamName: "Alpha",
      rank: 1,
      previousRank: 1,
      gameweeks: [
        { event: 9, points: 60, netPoints: 60 },
        { event: 10, points: 30, netPoints: 30 },
      ],
    }),
  ]);
  const merged = mergeLiveIntoMonth(table, new Map([[1, { points: 44, netPoints: 44 }]]), 10);
  const alpha = merged.standings[0];
  assert.equal(alpha.gameweeks.length, 2);
  assert.equal(alpha.netPoints, 104);
  // The published rank was already computed with this gameweek in it.
  assert.equal(alpha.previousRank, 1);
});

test("hits taken this gameweek come off the live month total", () => {
  const table = month([
    standing({ entryId: 1, teamName: "Alpha", rank: 1, gameweeks: [{ event: 9, points: 60, netPoints: 60 }] }),
    standing({ entryId: 2, teamName: "Bravo", rank: 2, gameweeks: [{ event: 9, points: 58, netPoints: 58 }] }),
  ]);
  const merged = mergeLiveIntoMonth(
    table,
    new Map([
      [1, { points: 40, netPoints: 28 }],
      [2, { points: 38, netPoints: 38 }],
    ]),
    10,
  );
  assert.deepEqual(merged.standings.map((row) => [row.teamName, row.netPoints, row.transferCost]), [
    ["Bravo", 96, 0],
    ["Alpha", 88, 12],
  ]);
});

test("managers level on the live total share a rank and the next rank skips", () => {
  const table = month([
    standing({ entryId: 1, teamName: "Alpha", rank: 1, gameweeks: [{ event: 9, points: 60, netPoints: 60 }] }),
    standing({ entryId: 2, teamName: "Bravo", rank: 2, gameweeks: [{ event: 9, points: 50, netPoints: 50 }] }),
    standing({ entryId: 3, teamName: "Charlie", rank: 3, gameweeks: [{ event: 9, points: 40, netPoints: 40 }] }),
  ]);
  const merged = mergeLiveIntoMonth(
    table,
    new Map([
      [1, { points: 10, netPoints: 10 }],
      [2, { points: 20, netPoints: 20 }],
      [3, { points: 15, netPoints: 15 }],
    ]),
    10,
  );
  assert.deepEqual(merged.standings.map((row) => [row.teamName, row.netPoints, row.rank]), [
    ["Alpha", 70, 1],
    ["Bravo", 70, 1],
    ["Charlie", 55, 3],
  ]);
});

test("a live gameweek outside the month window changes nothing", () => {
  const table = month([
    standing({ entryId: 1, teamName: "Alpha", rank: 1, gameweeks: [{ event: 9, points: 60, netPoints: 60 }] }),
  ], { startEvent: 9, stopEvent: 9 });
  const merged = mergeLiveIntoMonth(table, new Map([[1, { points: 99, netPoints: 99 }]]), 10);
  assert.equal(merged.standings[0].netPoints, 60);
});

// --- connecting a team ----------------------------------------------------

test("a team ID is read from a pasted FPL URL as well as a bare number", () => {
  assert.equal(parseTeamId("1234567"), 1234567);
  assert.equal(parseTeamId("  1234567 "), 1234567);
  assert.equal(parseTeamId("https://fantasy.premierleague.com/entry/1234567/event/10"), 1234567);
  assert.equal(parseTeamId("fantasy.premierleague.com/entry/42/history"), 42);
  assert.equal(parseTeamId("not a team"), null);
  assert.equal(parseTeamId(""), null);
  assert.equal(parseTeamId("0"), null);
});
