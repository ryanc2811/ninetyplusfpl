import assert from "node:assert/strict";
import test from "node:test";
import type { Position } from "../lib/contracts/fpl.ts";
import { applyAutomaticSubs, isLegalEleven } from "../lib/auto-subs.ts";
import type { EntryPicks } from "../lib/providers/live-provider.ts";

/**
 * Squads are written as a list of [position, minutes] in pick order: the
 * first eleven start, the last four are the bench in bench order. Player ids
 * are their pick position, so a squad reads the way it looks in the game.
 */
type Slot = [Position, number];

function squad(
  slots: Slot[],
  options: { captain?: number; vice?: number; chip?: string | null; subs?: Array<{ out: number; in: number }> } = {},
) {
  const captain = options.captain ?? 1;
  const vice = options.vice ?? 2;
  const picks: EntryPicks = {
    entryId: 1,
    event: 10,
    activeChip: options.chip ?? null,
    automaticSubs: options.subs ?? [],
    points: 0,
    transferCost: 0,
    bank: 0,
    squadValue: 100,
    picks: slots.map(([, ], index) => ({
      playerId: index + 1,
      position: index + 1,
      multiplier: index < 11 ? (index + 1 === captain ? 2 : 1) : 0,
      isCaptain: index + 1 === captain,
      isViceCaptain: index + 1 === vice,
    })),
  };
  const positions = new Map(slots.map(([position], index) => [index + 1, position]));
  const minutes = new Map(slots.map(([, played], index) => [index + 1, played]));
  const context = {
    position: (playerId: number) => positions.get(playerId) ?? null,
    minutes: (playerId: number) => minutes.get(playerId) ?? 0,
    // Every fixture in these squads has been played out unless a player is
    // explicitly left pending by the test.
    fixtureIsOver: () => true,
  };
  return { picks, context, positions };
}

function shape(result: ReturnType<typeof applyAutomaticSubs>, positions: Map<number, Position>) {
  const onPitch = [...result.multipliers.entries()]
    .filter(([, multiplier]) => multiplier > 0)
    .map(([playerId]) => positions.get(playerId)!);
  const count = (position: Position) => onPitch.filter((entry) => entry === position).length;
  return `${count("DEF")}-${count("MID")}-${count("FWD")}`;
}

// A 3-5-2: one keeper, three defenders, five midfielders, two forwards.
const THREE_FIVE_TWO: Slot[] = [
  ["GK", 90],
  ["DEF", 90], ["DEF", 90], ["DEF", 90],
  ["MID", 90], ["MID", 90], ["MID", 90], ["MID", 90], ["MID", 90],
  ["FWD", 90], ["FWD", 90],
  // Bench, left to right: reserve keeper, midfielder, defender, forward.
  ["GK", 90], ["MID", 90], ["DEF", 90], ["FWD", 90],
];

test("a blanking defender in a 3-5-2 is replaced by a defender, not the nearest bench player", () => {
  const slots = [...THREE_FIVE_TWO];
  slots[1] = ["DEF", 0];
  const { picks, context, positions } = squad(slots);
  const result = applyAutomaticSubs(picks, context);

  // Player 13 is the midfielder furthest left on the bench, but coming on
  // would leave two defenders, which is not a formation the game allows.
  assert.deepEqual(result.substitutions, [{ out: 2, in: 14 }]);
  assert.equal(result.multipliers.get(2), 0);
  assert.equal(result.multipliers.get(14), 1);
  assert.equal(result.multipliers.get(13), 0);
  assert.equal(shape(result, positions), "3-5-2");
});

test("the leftmost bench player comes on when the formation allows it", () => {
  const slots = [...THREE_FIVE_TWO];
  // A midfielder blanks out of a five-man midfield, so the bench midfielder
  // is both the leftmost outfielder and a legal replacement.
  slots[4] = ["MID", 0];
  const { picks, context, positions } = squad(slots);
  const result = applyAutomaticSubs(picks, context);
  assert.deepEqual(result.substitutions, [{ out: 5, in: 13 }]);
  assert.equal(shape(result, positions), "3-5-2");
});

test("a midfielder can replace a forward when the eleven stays legal", () => {
  // 4-4-2 with a forward blank: 4-5-1 is legal, so the bench midfielder goes on.
  const slots: Slot[] = [
    ["GK", 90],
    ["DEF", 90], ["DEF", 90], ["DEF", 90], ["DEF", 90],
    ["MID", 90], ["MID", 90], ["MID", 90], ["MID", 90],
    ["FWD", 90], ["FWD", 0],
    ["GK", 90], ["MID", 90], ["DEF", 90], ["FWD", 90],
  ];
  const { picks, context, positions } = squad(slots);
  const result = applyAutomaticSubs(picks, context);
  assert.deepEqual(result.substitutions, [{ out: 11, in: 13 }]);
  assert.equal(shape(result, positions), "4-5-1");
});

test("a defender comes on for a forward when that is the first legal swap", () => {
  // 3-5-2 with both forwards blank. The bench midfielder is further left,
  // but 3-6-1 is not a formation, so the bench defender goes on first and
  // the eleven ends as a legal 4-5-1.
  const slots = [...THREE_FIVE_TWO];
  slots[9] = ["FWD", 0];
  slots[10] = ["FWD", 0];
  const { picks, context, positions } = squad(slots);
  const result = applyAutomaticSubs(picks, context);
  assert.deepEqual(result.substitutions, [
    { out: 10, in: 14 },
    { out: 11, in: 15 },
  ]);
  assert.equal(shape(result, positions), "4-5-1");
});

test("a place is left empty when no bench player can legally fill it", () => {
  // 5-2-3 with a midfielder blank: a defender would make six at the back and
  // a forward would leave one in midfield, so only the bench midfielder can
  // come on — and here they did not play.
  const slots: Slot[] = [
    ["GK", 90],
    ["DEF", 90], ["DEF", 90], ["DEF", 90], ["DEF", 90], ["DEF", 90],
    ["MID", 90], ["MID", 0],
    ["FWD", 90], ["FWD", 90], ["FWD", 90],
    ["GK", 90], ["MID", 0], ["DEF", 90], ["FWD", 90],
  ];
  const { picks, context } = squad(slots);
  const result = applyAutomaticSubs(picks, context);
  assert.deepEqual(result.substitutions, []);
  // The blank stays in the eleven on nothing, rather than the game fielding
  // a formation it does not allow.
  assert.equal(result.multipliers.get(8), 1);
  assert.equal(result.multipliers.get(13), 0);
});

test("only the bench goalkeeper can replace the goalkeeper", () => {
  const slots = [...THREE_FIVE_TWO];
  slots[0] = ["GK", 0];
  const { picks, context } = squad(slots);
  const result = applyAutomaticSubs(picks, context);
  assert.deepEqual(result.substitutions, [{ out: 1, in: 12 }]);
});

test("a goalkeeper is never substituted into an outfield place", () => {
  const slots = [...THREE_FIVE_TWO];
  slots[4] = ["MID", 0];
  // The bench midfielder and defender did not play either, so only the
  // reserve keeper is available — and a keeper cannot fill a midfield place.
  slots[12] = ["MID", 0];
  slots[13] = ["DEF", 0];
  slots[14] = ["FWD", 0];
  const { picks, context } = squad(slots);
  assert.deepEqual(applyAutomaticSubs(picks, context).substitutions, []);
});

test("a bench player who has not played cannot come on", () => {
  const slots = [...THREE_FIVE_TWO];
  slots[4] = ["MID", 0];
  slots[12] = ["MID", 0];
  const { picks, context } = squad(slots);
  // The bench midfielder is skipped for not playing, so the defender comes on
  // and the eleven becomes a legal 4-4-2.
  assert.deepEqual(applyAutomaticSubs(picks, context).substitutions, [{ out: 5, in: 14 }]);
});

test("a starter whose fixture is still to come is not substituted", () => {
  const slots = [...THREE_FIVE_TWO];
  slots[4] = ["MID", 0];
  const { picks, context } = squad(slots);
  const pending = { ...context, fixtureIsOver: (playerId: number) => playerId !== 5 };
  assert.deepEqual(applyAutomaticSubs(picks, pending).substitutions, []);
});

test("three blanks are filled in bench order, each one checked against the formation", () => {
  const slots = [...THREE_FIVE_TWO];
  slots[1] = ["DEF", 0];
  slots[4] = ["MID", 0];
  slots[9] = ["FWD", 0];
  const { picks, context, positions } = squad(slots);
  const result = applyAutomaticSubs(picks, context);
  assert.deepEqual(result.substitutions, [
    { out: 2, in: 14 },
    { out: 5, in: 13 },
    { out: 10, in: 15 },
  ]);
  assert.equal(shape(result, positions), "3-5-2");
});

// --- the armband ----------------------------------------------------------

test("the armband passes to the vice-captain when the captain does not play", () => {
  const slots = [...THREE_FIVE_TWO];
  slots[9] = ["FWD", 0];
  const { picks, context } = squad(slots, { captain: 10, vice: 11 });
  const result = applyAutomaticSubs(picks, context);
  assert.equal(result.captainMoved, true);
  assert.equal(result.multipliers.get(10), 0);
  assert.equal(result.multipliers.get(11), 2);
  // The substitute comes on for a single score; the double went to the vice.
  assert.equal(result.multipliers.get(14), 1);
});

test("the double is lost when neither the captain nor the vice plays", () => {
  const slots = [...THREE_FIVE_TWO];
  slots[9] = ["FWD", 0];
  slots[10] = ["FWD", 0];
  const { picks, context } = squad(slots, { captain: 10, vice: 11 });
  const result = applyAutomaticSubs(picks, context);
  assert.equal(result.captainMoved, false);
  assert.equal(result.multipliers.get(11), 0);
});

test("a triple captain's armband is worth three to the vice-captain too", () => {
  const slots = [...THREE_FIVE_TWO];
  slots[9] = ["FWD", 0];
  const { picks, context } = squad(slots, { captain: 10, vice: 11, chip: "3xc" });
  picks.picks[9].multiplier = 3;
  const result = applyAutomaticSubs(picks, context);
  assert.equal(result.multipliers.get(11), 3);
});

// --- the official answer --------------------------------------------------

test("published substitutions are used as they are, not projected over", () => {
  const slots = [...THREE_FIVE_TWO];
  slots[1] = ["DEF", 0];
  const { picks, context } = squad(slots, { subs: [{ out: 2, in: 13 }] });
  const result = applyAutomaticSubs(picks, context);
  assert.equal(result.official, true);
  assert.deepEqual(result.substitutions, [{ out: 2, in: 13 }]);
  assert.equal(result.multipliers.get(14), 0);
});

// --- the rule itself ------------------------------------------------------

test("legal elevens are the eight shapes the game allows", () => {
  const eleven = (def: number, mid: number, fwd: number): Position[] => [
    "GK",
    ...Array.from({ length: def }, () => "DEF" as Position),
    ...Array.from({ length: mid }, () => "MID" as Position),
    ...Array.from({ length: fwd }, () => "FWD" as Position),
  ];
  assert.equal(isLegalEleven(eleven(3, 5, 2)), true);
  assert.equal(isLegalEleven(eleven(5, 2, 3)), true);
  assert.equal(isLegalEleven(eleven(2, 6, 2)), false);
  assert.equal(isLegalEleven(eleven(4, 6, 0)), false);
  assert.equal(isLegalEleven([...eleven(3, 5, 2), "GK"]), false);
});
