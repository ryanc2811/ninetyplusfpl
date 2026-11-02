import assert from "node:assert/strict";
import test from "node:test";
import type { LivePlayerPoints } from "../lib/contracts/live.ts";
import type { MonthlyResult, MonthlyStanding } from "../lib/contracts/leagues.ts";
import { parseTeamId } from "../lib/fpl-team-id.ts";
import {
  liveEntryScore,
  liveManager,
  mergeLiveIntoMonth,
  playersStillToPlay,
  type LiveContext,
} from "../lib/live-standings.ts";
import type { EntryPicks, LiveFixture, LivePlayerMeta } from "../lib/providers/live-provider.ts";

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

const META: LivePlayerMeta[] = [
  { playerId: 10, name: "Salah", team: 1, teamShort: "LIV", position: "MID" },
  { playerId: 11, name: "Haaland", team: 2, teamShort: "MCI", position: "FWD" },
  { playerId: 12, name: "Saka", team: 3, teamShort: "ARS", position: "MID" },
  { playerId: 13, name: "Gabriel", team: 3, teamShort: "ARS", position: "DEF" },
  { playerId: 20, name: "Raya", team: 3, teamShort: "ARS", position: "GK" },
];

const FIXTURES: LiveFixture[] = [
  { id: 1, homeTeam: 1, awayTeam: 4, started: false, finished: false, finishedProvisional: false, kickoff: "2026-11-07T16:30:00Z" },
  { id: 2, homeTeam: 2, awayTeam: 5, started: true, finished: true, finishedProvisional: true, kickoff: "2026-11-07T12:30:00Z" },
  { id: 3, homeTeam: 3, awayTeam: 6, started: true, finished: false, finishedProvisional: false, kickoff: "2026-11-07T15:00:00Z" },
];

/** A live Gameweek: points and minutes per player, over the fixtures above. */
function context(
  points: Record<number, number>,
  minutes: Record<number, number> = {},
  fixtures: LiveFixture[] = FIXTURES,
): LiveContext {
  const liveByPlayer = new Map<number, LivePlayerPoints>(
    Object.entries(points).map(([id, value]) => [
      Number(id),
      {
        playerId: Number(id),
        points: value,
        minutes: minutes[Number(id)] ?? 90,
        played: (minutes[Number(id)] ?? 90) > 0,
        bps: 0,
        bonus: 0,
        fixtures: [],
      },
    ]),
  );
  return {
    liveByPlayer,
    meta: new Map(META.map((player) => [player.playerId, player])),
    fixtures,
    teamShort: new Map(META.map((player) => [player.team, player.teamShort])),
  };
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

test("only the scoring eleven counts, and the captain counts twice", () => {
  const entry = picks({
    entryId: 1,
    picks: [pick(10, 1), pick(11, 2), pick(12, 1), pick(13, 0)],
  });
  // 6 + (9 × 2) + 2, with the bench defender's 14 points ignored.
  assert.equal(liveEntryScore(entry, context({ 10: 6, 11: 9, 12: 2, 13: 14 })).points, 26);
});

test("a triple captain multiplies by three", () => {
  const entry = picks({
    entryId: 1,
    activeChip: "3xc",
    picks: [pick(10, 3), pick(11, 1)],
  });
  assert.equal(liveEntryScore(entry, context({ 10: 12, 11: 3 })).points, 39);
});

test("a hit comes off the live score, which is what the month counts", () => {
  const entry = picks({ entryId: 1, transferCost: 8, picks: [pick(10, 1)] });
  const score = liveEntryScore(entry, context({ 10: 50 }));
  assert.equal(score.points, 50);
  assert.equal(score.netPoints, 42);
  assert.equal(score.transferCost, 8);
});

test("a published substitution is scored as the game scored it", () => {
  const entry = picks({
    entryId: 1,
    picks: [pick(11, 1), pick(13, 0)],
    automaticSubs: [{ out: 11, in: 13 }],
  });
  const score = liveEntryScore(entry, context({ 11: 0, 13: 7 }, { 11: 0 }));
  assert.equal(score.points, 7);
  assert.equal(score.subs.official, true);
});

// --- still to play --------------------------------------------------------

test("players still to play are the scoring eleven whose fixture has not finished", () => {
  const entry = picks({
    entryId: 1,
    picks: [pick(10, 2), pick(11, 1), pick(12, 1), pick(20, 0)],
  });
  const toPlay = playersStillToPlay(entry, context({ 10: 0, 11: 9, 12: 1 }));
  // Haaland's fixture is over; the benched keeper never counted.
  assert.deepEqual(toPlay.map((player) => player.name), ["Salah", "Saka"]);
  // The captain is listed first, because that is the one that swings a month.
  assert.equal(toPlay[0].multiplier, 2);
  assert.equal(toPlay[0].fixture, "LIV v ?");
});

test("a match that has been played is over, even before bonus is confirmed", () => {
  // The official feed leaves `finished` false until bonus is checked, which
  // can be the next day; `finished_provisional` is full time.
  const played: LiveFixture[] = [
    { id: 3, homeTeam: 3, awayTeam: 6, started: true, finished: false, finishedProvisional: true, kickoff: "2026-11-07T15:00:00Z" },
  ];
  const entry = picks({ entryId: 1, picks: [pick(12, 1)] });
  assert.deepEqual(playersStillToPlay(entry, context({ 12: 4 }, {}, played)), []);
});

test("a manager in progress reports what has played, what has not, and any substitution", () => {
  const entry = picks({
    entryId: 7,
    transferCost: 4,
    picks: [pick(10, 2), pick(11, 1), pick(12, 1)],
  });
  const result = liveManager(entry, context({ 10: 2, 11: 9, 12: 1 }, { 10: 20, 11: 90, 12: 60 }));
  assert.equal(result.points, 2 * 2 + 9 + 1);
  assert.equal(result.netPoints, 10);
  assert.equal(result.playersToPlay, 2);
  // Only Haaland's fixture is complete.
  assert.equal(result.playersPlayed, 1);
  assert.deepEqual(result.substitutions, []);
});

test("a blank is substituted while the Gameweek is still being played", () => {
  /*
   * A full squad whose starting forward never appeared. The official feed
   * publishes no substitution until the Gameweek ends, so without projecting
   * one this manager's score would be missing the bench player who replaced
   * him — which is the score everyone else can see on the official site.
   */
  const shape: Array<[number, LivePlayerMeta["position"], number, number]> = [
    // id, position, multiplier, points
    [100, "GK", 1, 2],
    [101, "DEF", 1, 6], [102, "DEF", 1, 2], [103, "DEF", 1, 1], [104, "DEF", 1, 2],
    [105, "MID", 1, 5], [106, "MID", 1, 3], [107, "MID", 1, 8], [108, "MID", 1, 2],
    [109, "FWD", 1, 7], [110, "FWD", 1, 0],
    [111, "GK", 0, 3], [112, "MID", 0, 9], [113, "DEF", 0, 4], [114, "FWD", 0, 6],
  ];
  const squadMeta = new Map<number, LivePlayerMeta>(
    shape.map(([id, position]) => [
      id,
      { playerId: id, name: `P${id}`, team: 9, teamShort: "TST", position },
    ]),
  );
  const over: LiveFixture[] = [
    { id: 9, homeTeam: 9, awayTeam: 8, started: true, finished: false, finishedProvisional: true, kickoff: "2026-11-07T15:00:00Z" },
  ];
  const squadContext: LiveContext = {
    liveByPlayer: new Map(
      shape.map(([id, , , points]) => [
        id,
        {
          playerId: id,
          points,
          minutes: id === 110 ? 0 : 90,
          played: id !== 110,
          bps: 0,
          bonus: 0,
          fixtures: [9],
        },
      ]),
    ),
    meta: squadMeta,
    fixtures: over,
    teamShort: new Map([[9, "TST"], [8, "OPP"]]),
  };
  const entry = picks({
    entryId: 7,
    picks: shape.map(([id, , multiplier], index) => pick(id, multiplier, index + 1)),
  });

  const result = liveManager(entry, squadContext);
  // A 4-4-2 losing a forward becomes a legal 4-5-1, so the bench midfielder
  // — the leftmost outfielder who played — comes on and scores nine.
  assert.deepEqual(result.substitutions, [{ out: "P110", in: "P112", official: false }]);
  assert.equal(result.points, 2 + 6 + 2 + 1 + 2 + 5 + 3 + 8 + 2 + 7 + 9);
  assert.equal(result.playersToPlay, 0);
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
