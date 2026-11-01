import assert from "node:assert/strict";
import test from "node:test";
import type { ManagerGameweek, ManagerSeason } from "../lib/contracts/leagues.ts";
import {
  awardBadges,
  managerInsights,
  monthlyResults,
  monthlyStandings,
  monthWindows,
  upcomingMonthWindows,
  type EventStatus,
  type RawPhase,
} from "../lib/league-insights.ts";

/** Mirrors the official 2026/27 phase layout. */
const phases: RawPhase[] = [
  { id: 1, name: "Overall", start_event: 1, stop_event: 38 },
  { id: 2, name: "August", start_event: 1, stop_event: 2 },
  { id: 3, name: "September", start_event: 3, stop_event: 5 },
  { id: 4, name: "October", start_event: 6, stop_event: 9 },
];

function events(scoredThrough: number, provisional: number[] = []): EventStatus[] {
  return Array.from({ length: 9 }, (_, index) => {
    const id = index + 1;
    return {
      id,
      finished: id <= scoredThrough || provisional.includes(id),
      data_checked: id <= scoredThrough,
    };
  });
}

function week(overrides: Partial<ManagerGameweek> & { event: number }): ManagerGameweek {
  const points = overrides.points ?? 50;
  const transferCost = overrides.transferCost ?? 0;
  return {
    points,
    netPoints: points - transferCost,
    totalPoints: 0,
    overallRank: null,
    transfers: 0,
    transferCost,
    pointsOnBench: 0,
    squadValue: 100,
    bank: 0,
    ...overrides,
  };
}

function season(
  entryId: number,
  teamName: string,
  gameweeks: ManagerGameweek[],
): ManagerSeason {
  return { entryId, teamName, managerName: `Manager ${entryId}`, gameweeks };
}

// --- month windows -------------------------------------------------------

test("month windows come from the official phases, excluding Overall", () => {
  const windows = monthWindows(phases, events(0));
  assert.equal(windows.length, 3);
  assert.deepEqual(
    windows.map((window) => window.name),
    ["August", "September", "October"],
  );
  assert.deepEqual(
    windows.map((window) => [window.startEvent, window.stopEvent]),
    [[1, 2], [3, 5], [6, 9]],
  );
});

test("a month is complete only when every gameweek is scored and checked", () => {
  const partial = monthWindows(phases, events(1));
  const august = partial.find((window) => window.name === "August")!;
  assert.equal(august.complete, false);
  assert.equal(august.current, true);
  assert.equal(august.gameweeksPlayed, 1);

  const done = monthWindows(phases, events(2));
  assert.equal(done.find((window) => window.name === "August")!.complete, true);
});

test("a gameweek finished but not data-checked does not complete a month", () => {
  // Provisional bonus can still move, so the month must not be awarded yet.
  const windows = monthWindows(phases, events(1, [2]));
  assert.equal(windows.find((window) => window.name === "August")!.complete, false);
});

test("the month after the last scored one is current, later months are not", () => {
  const windows = monthWindows(phases, events(2));
  assert.equal(windows.find((window) => window.name === "September")!.current, true);
  assert.equal(windows.find((window) => window.name === "October")!.current, false);
});

// --- monthly standings ---------------------------------------------------

test("monthly standings only count gameweeks inside the window", () => {
  const seasons = [
    season(1, "Alpha", [week({ event: 1, points: 60 }), week({ event: 3, points: 99 })]),
  ];
  const august = monthWindows(phases, events(5)).find((window) => window.name === "August")!;
  const standings = monthlyStandings(august, seasons);
  assert.equal(standings[0].netPoints, 60);
  assert.equal(standings[0].gameweeksCounted, 1);
});

test("a month is scored net of transfer costs", () => {
  const seasons = [
    season(1, "Alpha", [week({ event: 1, points: 70, transferCost: 8 })]),
    season(2, "Bravo", [week({ event: 1, points: 65, transferCost: 0 })]),
  ];
  const august = monthWindows(phases, events(2)).find((window) => window.name === "August")!;
  const standings = monthlyStandings(august, seasons);
  // 70 - 8 = 62 loses to a clean 65 despite the higher raw score.
  assert.equal(standings[0].teamName, "Bravo");
  assert.equal(standings[0].netPoints, 65);
  assert.equal(standings[1].netPoints, 62);
  assert.equal(standings[1].grossPoints, 70);
});

test("tied managers share a rank and the next rank skips", () => {
  const seasons = [
    season(1, "Alpha", [week({ event: 1, points: 70 })]),
    season(2, "Bravo", [week({ event: 1, points: 70 })]),
    season(3, "Charlie", [week({ event: 1, points: 50 })]),
  ];
  const august = monthWindows(phases, events(2)).find((window) => window.name === "August")!;
  const standings = monthlyStandings(august, seasons);
  assert.deepEqual(standings.map((row) => row.rank), [1, 1, 3]);
});

test("rank movement compares against the standing before the latest gameweek", () => {
  const seasons = [
    // Alpha led after GW3; Bravo overtakes on the latest scored gameweek.
    season(1, "Alpha", [week({ event: 3, points: 80 }), week({ event: 4, points: 30 })]),
    season(2, "Bravo", [week({ event: 3, points: 60 }), week({ event: 4, points: 70 })]),
    season(3, "Charlie", [week({ event: 3, points: 40 }), week({ event: 4, points: 40 })]),
  ];
  const september = monthWindows(phases, events(4)).find((w) => w.name === "September")!;
  const standings = monthlyStandings(september, seasons);

  assert.deepEqual(standings.map((row) => [row.teamName, row.rank, row.previousRank]), [
    ["Bravo", 1, 2],
    ["Alpha", 2, 1],
    ["Charlie", 3, 3],
  ]);
});

test("nothing has moved while a month has only one scored gameweek", () => {
  const seasons = [
    season(1, "Alpha", [week({ event: 3, points: 80 })]),
    season(2, "Bravo", [week({ event: 3, points: 60 })]),
  ];
  const september = monthWindows(phases, events(3)).find((w) => w.name === "September")!;
  for (const row of monthlyStandings(september, seasons)) {
    assert.equal(row.previousRank, null);
  }
});

test("movement is measured net of hits, like the standing itself", () => {
  const seasons = [
    season(1, "Alpha", [week({ event: 3, points: 60 }), week({ event: 4, points: 60, transferCost: 12 })]),
    season(2, "Bravo", [week({ event: 3, points: 55 }), week({ event: 4, points: 55 })]),
  ];
  const september = monthWindows(phases, events(4)).find((w) => w.name === "September")!;
  const standings = monthlyStandings(september, seasons);
  // Alpha scored more in both weeks but a −12 hit drops them behind.
  assert.deepEqual(standings.map((row) => [row.teamName, row.netPoints, row.rank, row.previousRank]), [
    ["Bravo", 110, 1, 2],
    ["Alpha", 108, 2, 1],
  ]);
});

test("each standing carries the month's gameweeks in order", () => {
  const seasons = [
    season(1, "Alpha", [
      week({ event: 4, points: 55, transferCost: 4 }),
      week({ event: 3, points: 62 }),
    ]),
  ];
  const september = monthWindows(phases, events(4)).find((w) => w.name === "September")!;
  const [alpha] = monthlyStandings(september, seasons);
  assert.deepEqual(alpha.gameweeks, [
    { event: 3, points: 62, netPoints: 62 },
    { event: 4, points: 55, netPoints: 51 },
  ]);
});

test("a gameweek in progress counts toward the month as soon as it is scored", () => {
  const seasons = [
    season(1, "Alpha", [week({ event: 3, points: 50 }), week({ event: 4, points: 20 })]),
    season(2, "Bravo", [week({ event: 3, points: 50 })]),
  ];
  // September runs GW3-5, so with GW4 scored the month is live, not complete.
  const september = monthWindows(phases, events(4)).find((w) => w.name === "September")!;
  assert.equal(september.complete, false);
  assert.equal(september.current, true);

  const standings = monthlyStandings(september, seasons);
  assert.deepEqual(standings.map((row) => [row.teamName, row.netPoints, row.gameweeksCounted]), [
    ["Alpha", 70, 2],
    ["Bravo", 50, 1],
  ]);
});

test("upcoming months are the windows the season has not reached", () => {
  const upcoming = upcomingMonthWindows(phases, events(3));
  assert.deepEqual(upcoming.map((month) => month.name), ["October"]);
  assert.equal(upcoming[0].startEvent, 6);
  // Once October has a scored gameweek it is no longer upcoming.
  assert.deepEqual(upcomingMonthWindows(phases, events(6)).map((m) => m.name), []);
});

// --- badges --------------------------------------------------------------

test("manager of the month is awarded only for a completed month", () => {
  const seasons = [
    season(1, "Alpha", [week({ event: 1, points: 80 })]),
    season(2, "Bravo", [week({ event: 1, points: 40 })]),
  ];
  // GW1 scored, GW2 not: August is incomplete.
  const partial = monthlyResults(phases, events(1), seasons);
  const partialBadges = awardBadges(partial, managerInsights(seasons, partial));
  assert.equal(partialBadges.filter((badge) => badge.kind === "manager-of-the-month").length, 0);

  const complete = monthlyResults(phases, events(2), seasons);
  const badges = awardBadges(complete, managerInsights(seasons, complete));
  const motm = badges.find((badge) => badge.kind === "manager-of-the-month")!;
  assert.equal(motm.period, "August");
  assert.equal(motm.teamName, "Alpha");
  assert.equal(motm.value, 80);
});

test("a shared month awards both managers and marks the badge shared", () => {
  const seasons = [
    season(1, "Alpha", [week({ event: 1, points: 70 })]),
    season(2, "Bravo", [week({ event: 1, points: 70 })]),
  ];
  const months = monthlyResults(phases, events(2), seasons);
  const badges = awardBadges(months, managerInsights(seasons, months))
    .filter((badge) => badge.kind === "manager-of-the-month");
  assert.equal(badges.length, 2);
  assert.ok(badges.every((badge) => badge.detail.includes("shared")));
});

test("season badges cover bench regret, hits and consistency", () => {
  const seasons = [
    season(1, "Alpha", [
      week({ event: 1, points: 90, pointsOnBench: 30 }),
      week({ event: 2, points: 20 }),
    ]),
    season(2, "Bravo", [
      week({ event: 1, points: 55, transferCost: 12 }),
      week({ event: 2, points: 57 }),
    ]),
  ];
  const months = monthlyResults(phases, events(2), seasons);
  const badges = awardBadges(months, managerInsights(seasons, months));
  const kind = (name: string) => badges.find((badge) => badge.kind === name);
  assert.equal(kind("bench-regret")?.teamName, "Alpha");
  assert.equal(kind("hit-taker")?.teamName, "Bravo");
  assert.equal(kind("best-gameweek")?.teamName, "Alpha");
  // Bravo scored 43 then 57; Alpha swung 90 to 20.
  assert.equal(kind("most-consistent")?.teamName, "Bravo");
});

test("no gameweeks played yields no badges and no crash", () => {
  const seasons = [season(1, "Alpha", []), season(2, "Bravo", [])];
  const months = monthlyResults(phases, events(0), seasons);
  const insights = managerInsights(seasons, months);
  assert.deepEqual(months, []);
  assert.deepEqual(awardBadges(months, insights), []);
  assert.equal(insights[0].bestGameweek, null);
  assert.equal(insights[0].consistency, null);
  assert.equal(insights[0].totalPoints, 0);
});

// --- manager insights ----------------------------------------------------

test("insights aggregate bench, hits, extremes and green arrows", () => {
  const seasons = [
    season(1, "Alpha", [
      week({ event: 1, points: 60, pointsOnBench: 5, overallRank: 900_000 }),
      week({ event: 2, points: 80, transferCost: 4, pointsOnBench: 2, overallRank: 400_000 }),
      week({ event: 3, points: 30, overallRank: 600_000 }),
    ]),
  ];
  const months = monthlyResults(phases, events(5), seasons);
  const [insight] = managerInsights(seasons, months);
  assert.equal(insight.totalPoints, 60 + 76 + 30);
  assert.equal(insight.benchPoints, 7);
  assert.equal(insight.transferCost, 4);
  assert.deepEqual(insight.bestGameweek, { event: 2, points: 76 });
  assert.deepEqual(insight.worstGameweek, { event: 3, points: 30 });
  // Only GW2 improved on the previous rank.
  assert.equal(insight.greenArrows, 1);
});

test("months won is counted from completed months only", () => {
  const seasons = [
    season(1, "Alpha", [
      week({ event: 1, points: 80 }),
      week({ event: 2, points: 80 }),
      week({ event: 3, points: 10 }),
    ]),
    season(2, "Bravo", [
      week({ event: 1, points: 40 }),
      week({ event: 2, points: 40 }),
      week({ event: 3, points: 99 }),
    ]),
  ];
  // August complete, September still in progress.
  const months = monthlyResults(phases, events(3), seasons);
  const insights = managerInsights(seasons, months);
  assert.equal(insights.find((row) => row.teamName === "Alpha")!.monthsWon, 1);
  assert.equal(insights.find((row) => row.teamName === "Bravo")!.monthsWon, 0);
});
