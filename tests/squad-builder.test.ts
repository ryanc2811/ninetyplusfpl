import assert from "node:assert/strict";
import test from "node:test";
import { formationForLineup, optimiseSquad, projectedLineupPoints, projectedStrategyPoints, replacementError, resolveCaptaincy, selectBestLineup, selectLineup, swapLineupPlayer, validateLineup, validateSquad, type SquadAsset } from "../lib/squad-builder.ts";

const squad: SquadAsset[] = [
  { id: 1, name: "GK1", team: "A", position: "GK", price: 5, xp1: 4, xp3: 12 },
  { id: 2, name: "GK2", team: "B", position: "GK", price: 4, xp1: 3, xp3: 9 },
  ...Array.from({ length: 5 }, (_, index) => ({ id: 10 + index, name: `DEF${index}`, team: String.fromCharCode(67 + index), position: "DEF" as const, price: 4.5, xp1: 3 + index, xp3: 9 + index })),
  ...Array.from({ length: 5 }, (_, index) => ({ id: 20 + index, name: `MID${index}`, team: String.fromCharCode(72 + index), position: "MID" as const, price: 5, xp1: 4 + index, xp3: 11 + index })),
  ...Array.from({ length: 3 }, (_, index) => ({ id: 30 + index, name: `FWD${index}`, team: String.fromCharCode(77 + index), position: "FWD" as const, price: 6, xp1: 5 + index, xp3: 13 + index })),
];

test("validates the official 15-player squad composition", () => {
  const validation = validateSquad(squad);
  assert.equal(validation.valid, true);
  assert.equal(validation.counts.GK, 2);
  assert.equal(validation.counts.DEF, 5);
  assert.equal(validation.counts.MID, 5);
  assert.equal(validation.counts.FWD, 3);
  assert.ok(validation.cost <= 100);
});

test("rejects replacements that break position, budget, or club limits", () => {
  assert.match(
    replacementError(squad, 10, { id: 100, name: "Wrong", team: "Z", position: "MID", price: 4.5, xp1: 4, xp3: 12 }) ?? "",
    /DEF/,
  );
  assert.match(
    replacementError(squad, 30, { id: 101, name: "Too expensive", team: "Z", position: "FWD", price: 40, xp1: 9, xp3: 27 }) ?? "",
    /budget/,
  );
  const sameClubSquad = squad.map((player, index) => index < 3 ? { ...player, team: "A" } : player);
  assert.match(
    replacementError(sameClubSquad, 13, { id: 102, name: "Fourth A", team: "A", position: "DEF", price: 4.5, xp1: 4, xp3: 12 }) ?? "",
    /three-player club limit/,
  );
  assert.match(
    replacementError(squad, 11, { ...squad[2], id: 999 }) ?? "",
    /already in the squad/,
  );
});

test("selects a legal formation and applies captain points once", () => {
  const lineup = selectLineup(squad, "3-4-3");
  assert.equal(lineup.starters.length, 11);
  assert.equal(lineup.bench.length, 4);
  assert.equal(lineup.starters.filter((player) => player.position === "GK").length, 1);
  assert.equal(lineup.starters.filter((player) => player.position === "DEF").length, 3);
  assert.equal(lineup.starters.filter((player) => player.position === "MID").length, 4);
  assert.equal(lineup.starters.filter((player) => player.position === "FWD").length, 3);

  const captain = [...lineup.starters].sort((a, b) => b.xp1 - a.xp1)[0];
  const base = lineup.starters.reduce((total, player) => total + player.xp1, 0);
  assert.equal(projectedLineupPoints(lineup.starters, captain.id), Number((base + captain.xp1).toFixed(1)));
});

test("keeps captain and vice-captain distinct and inside the XI", () => {
  const lineup = selectLineup(squad, "4-4-2");
  const resolved = resolveCaptaincy(lineup.starters, 999, 999);
  assert.notEqual(resolved.captainId, resolved.viceCaptainId);
  assert.ok(lineup.starters.some((player) => player.id === resolved.captainId));
  assert.ok(lineup.starters.some((player) => player.id === resolved.viceCaptainId));
});

test("swaps a bench player into a legal XI and rejects an illegal formation", () => {
  const lineup = selectLineup(squad, "4-4-2");
  const benchForward = lineup.bench.find((player) => player.position === "FWD");
  const startingForward = lineup.starters.find((player) => player.position === "FWD");
  assert.ok(benchForward && startingForward);
  const swapped = swapLineupPlayer(
    squad,
    lineup.starters.map((player) => player.id),
    startingForward.id,
    benchForward.id,
  );
  assert.equal(swapped?.formation, "4-4-2");
  assert.ok(swapped?.starterIds.includes(benchForward.id));
  assert.equal(validateLineup(squad, swapped?.starterIds ?? []).valid, true);

  const startingGoalkeeper = lineup.starters.find((player) => player.position === "GK");
  assert.ok(startingGoalkeeper);
  assert.equal(
    swapLineupPlayer(
      squad,
      lineup.starters.map((player) => player.id),
      startingGoalkeeper.id,
      benchForward.id,
    ),
    null,
  );
});

test("selects the best existing XI and promotes a stronger bench player", () => {
  const altered = squad.map((player) =>
    player.id === 30 ? { ...player, xp1: 20 } :
    player.id === 32 ? { ...player, xp1: 1 } :
    player,
  );
  const best = selectBestLineup(altered, 1);
  assert.ok(best.starters.some((player) => player.id === 30));
  assert.ok(best.bench.some((player) => player.id === 32));
  assert.equal(formationForLineup(best.starters), best.formation);
});

test("starts the higher-projected striker when two forwards share a club", () => {
  const forestScenario = squad.map((player) => {
    if (player.id === 30) return { ...player, name: "Chris Wood", team: "NFO", xp1: 3.1 };
    if (player.id === 31) return { ...player, name: "Igor Jesus", team: "NFO", xp1: 5.4 };
    if (player.id === 32) return { ...player, name: "Other forward", xp1: 6.2 };
    return player;
  });
  const lineup = selectLineup(forestScenario, "4-4-2");
  assert.ok(lineup.starters.some((player) => player.name === "Igor Jesus"));
  assert.ok(lineup.bench.some((player) => player.name === "Chris Wood"));
});

test("uses the requested projection horizon when selecting a lineup", () => {
  const horizonScenario = squad.map((player) => {
    if (player.id === 30) return { ...player, xp1: 9, xp3: 10 };
    if (player.id === 31) return { ...player, xp1: 4, xp3: 24 };
    if (player.id === 32) return { ...player, xp1: 8, xp3: 22 };
    return player;
  });
  const threeWeekLineup = selectLineup(horizonScenario, "4-4-2", 3);
  assert.ok(threeWeekLineup.starters.some((player) => player.id === 31));
  assert.ok(threeWeekLineup.bench.some((player) => player.id === 30));
});

test("builds a valid budget-constrained squad from the full player market", () => {
  const market: SquadAsset[] = (["GK", "DEF", "MID", "FWD"] as const).flatMap(
    (position, positionIndex) =>
      Array.from({ length: position === "GK" ? 8 : 20 }, (_, index) => ({
        id: 1000 + positionIndex * 100 + index,
        name: `${position}-${index}`,
        team: `T${index % 10}`,
        position,
        price: position === "GK" ? 4 + index * 0.2 : 4.5 + index * 0.25,
        xp1: 2 + index * 0.35 + positionIndex * 0.1,
        xp3: 6 + index,
      })),
  );
  const result = optimiseSquad(market, 100, 1);
  assert.ok(result);
  assert.equal(validateSquad(result.squad).valid, true);
  assert.equal(result.lineup.starters.length, 11);
  assert.ok(result.squad.some((player) => player.xp1 > 6));
  assert.ok(result.lineup.captain);
});

test("Bench Boost optimisation gives the bench full value", () => {
  const market: SquadAsset[] = (["GK", "DEF", "MID", "FWD"] as const).flatMap(
    (position, positionIndex) =>
      Array.from({ length: position === "GK" ? 8 : 20 }, (_, index) => ({
        id: 2000 + positionIndex * 100 + index,
        name: `${position}-BB-${index}`,
        team: `B${index % 10}`,
        position,
        price: position === "GK" ? 4 + index * 0.2 : 4.5 + index * 0.25,
        xp1: 2 + index * 0.35 + positionIndex * 0.1,
        xp3: 15,
      })),
  );
  const standard = optimiseSquad(market, 100, 1, "standard");
  const benchBoost = optimiseSquad(market, 100, 1, "bench-boost");
  assert.ok(standard && benchBoost);
  const standardBench = standard.lineup.bench.reduce((total, player) => total + player.xp1, 0);
  const boostedBench = benchBoost.lineup.bench.reduce((total, player) => total + player.xp1, 0);
  assert.ok(boostedBench > standardBench);
  assert.ok(
    projectedStrategyPoints(
      benchBoost.lineup.starters,
      benchBoost.lineup.bench,
      benchBoost.lineup.captain.id,
      "bench-boost",
    ) > projectedLineupPoints(benchBoost.lineup.starters, benchBoost.lineup.captain.id),
  );
});

test("Bench Boost optimisation does not sacrifice GW1 for an unscaled three-week total", () => {
  const base = squad.map((player) => ({
    ...player,
    id: player.id + 5_000,
    team: `${player.team}-future`,
    xp3: player.xp1 + 2,
  }));
  const selectedForward = base.find((player) => player.position === "FWD")!;
  const futureOnlyForward: SquadAsset = {
    ...selectedForward,
    id: 9_999,
    name: "Future-only forward",
    xp1: selectedForward.xp1 - 4,
    xp3: selectedForward.xp3 + 22,
  };
  const result = optimiseSquad([...base, futureOnlyForward], 100, 1, "bench-boost");

  assert.ok(result);
  assert.ok(result.squad.some((player) => player.id === selectedForward.id));
  assert.ok(!result.squad.some((player) => player.id === futureOnlyForward.id));
});
