import type { Position } from "./contracts/fpl";
import type { SquadStrategy } from "./chip-strategy";

export type Formation = "3-4-3" | "3-5-2" | "4-4-2" | "4-3-3" | "4-5-1" | "5-4-1" | "5-3-2" | "5-2-3";

export type SquadAsset = {
  id: number;
  name: string;
  team: string;
  position: Position;
  price: number;
  xp1: number;
  xp3: number;
};

export const FORMATIONS: Formation[] = ["3-4-3", "3-5-2", "4-4-2", "4-3-3", "4-5-1", "5-4-1", "5-3-2", "5-2-3"];

const REQUIRED: Record<Position, number> = { GK: 2, DEF: 5, MID: 5, FWD: 3 };

/**
 * The XI the crowd is picking: the highest-owned legal starting eleven,
 * captained by the highest-owned outfield asset.
 *
 * This is the honest reference point for "how different am I?" — comparing a
 * squad against it measures divergence from the template rather than against
 * an invented benchmark.
 */
export function templateLineup<T extends SquadAsset & { ownership: number }>(
  players: T[],
  horizon: 1 | 3 = 1,
) {
  const byOwnership = [...players].sort((a, b) => b.ownership - a.ownership);
  const take = (position: Position, count: number) =>
    byOwnership.filter((player) => player.position === position).slice(0, count);

  let best: { starters: T[]; points: number } | null = null;
  for (const formation of FORMATIONS) {
    const [defenders, midfielders, forwards] = formation.split("-").map(Number);
    const starters = [
      ...take("GK", 1),
      ...take("DEF", defenders),
      ...take("MID", midfielders),
      ...take("FWD", forwards),
    ];
    if (starters.length !== 11) continue;
    const points = starters.reduce(
      (total, player) => total + (horizon === 1 ? player.xp1 : player.xp3),
      0,
    );
    if (!best || points > best.points) best = { starters, points };
  }
  if (!best) return null;

  const captain = [...best.starters]
    .filter((player) => player.position !== "GK")
    .sort((a, b) => b.ownership - a.ownership)[0] ?? best.starters[0];

  return {
    starters: best.starters,
    captain,
    // Captain scores twice, matching how a real Gameweek is scored.
    points: Number((best.points + (horizon === 1 ? captain.xp1 : captain.xp3)).toFixed(1)),
  };
}

export function squadCost(squad: SquadAsset[]) {
  return Number(squad.reduce((total, player) => total + player.price, 0).toFixed(1));
}

export function clubCounts(squad: SquadAsset[]) {
  return squad.reduce<Record<string, number>>((counts, player) => {
    counts[player.team] = (counts[player.team] ?? 0) + 1;
    return counts;
  }, {});
}

export function validateSquad(squad: SquadAsset[], budget = 100) {
  const issues: string[] = [];
  const counts = squad.reduce<Record<Position, number>>(
    (total, player) => ({ ...total, [player.position]: total[player.position] + 1 }),
    { GK: 0, DEF: 0, MID: 0, FWD: 0 },
  );
  const duplicateIds = new Set<number>();
  const seenIds = new Set<number>();
  for (const player of squad) {
    if (seenIds.has(player.id)) duplicateIds.add(player.id);
    seenIds.add(player.id);
  }

  if (squad.length !== 15) issues.push(`Squad must contain 15 players; currently ${squad.length}`);
  for (const position of Object.keys(REQUIRED) as Position[]) {
    if (counts[position] !== REQUIRED[position]) issues.push(`Squad needs ${REQUIRED[position]} ${position}; currently ${counts[position]}`);
  }
  if (squadCost(squad) > budget) issues.push(`Squad exceeds the £${budget.toFixed(1)}m budget`);
  const overClubCap = Object.entries(clubCounts(squad)).filter(([, count]) => count > 3);
  if (overClubCap.length) issues.push(`${overClubCap.map(([team]) => team).join(", ")} exceed the three-player club limit`);
  if (duplicateIds.size) issues.push("A player cannot appear twice");

  return { valid: issues.length === 0, issues, cost: squadCost(squad), counts, clubs: clubCounts(squad) };
}

export function replacementError(squad: SquadAsset[], outgoingId: number, incoming: SquadAsset, budget = 100) {
  const outgoing = squad.find((player) => player.id === outgoingId);
  if (!outgoing) return "Select a squad player to replace first";
  if (outgoing.position !== incoming.position) return `Choose another ${outgoing.position}`;
  if (squad.some((player) =>
    player.id !== outgoingId &&
    (player.id === incoming.id || (player.name === incoming.name && player.team === incoming.team))
  )) return `${incoming.name} is already in the squad`;
  const nextSquad = squad.map((player) => player.id === outgoingId ? incoming : player);
  const validation = validateSquad(nextSquad, budget);
  return validation.valid ? null : validation.issues[0];
}

export function replaceSquadPlayer(squad: SquadAsset[], outgoingId: number, incoming: SquadAsset) {
  return squad.map((player) => player.id === outgoingId ? incoming : player);
}

export function selectLineup(
  squad: SquadAsset[],
  formation: Formation,
  horizon: 1 | 3 = 1,
) {
  const [defenders, midfielders, forwards] = formation.split("-").map(Number);
  const required: Record<Position, number> = { GK: 1, DEF: defenders, MID: midfielders, FWD: forwards };
  const starters: SquadAsset[] = [];
  const bench: SquadAsset[] = [];

  for (const position of Object.keys(required) as Position[]) {
    const ranked = squad
      .filter((player) => player.position === position)
      .sort((a, b) => projection(b, horizon) - projection(a, horizon));
    starters.push(...ranked.slice(0, required[position]));
    bench.push(...ranked.slice(required[position]));
  }

  const orderedBench = [
    ...bench.filter((player) => player.position === "GK"),
    ...bench
      .filter((player) => player.position !== "GK")
      .sort((a, b) => projection(b, horizon) - projection(a, horizon)),
  ];
  return { starters, bench: orderedBench };
}

function projection(player: SquadAsset, horizon: 1 | 3) {
  return horizon === 1 ? player.xp1 : player.xp3;
}

export function formationForLineup(starters: SquadAsset[]): Formation | null {
  if (starters.length !== 11) return null;
  const goalkeepers = starters.filter((player) => player.position === "GK").length;
  const defenders = starters.filter((player) => player.position === "DEF").length;
  const midfielders = starters.filter((player) => player.position === "MID").length;
  const forwards = starters.filter((player) => player.position === "FWD").length;
  if (goalkeepers !== 1) return null;
  const formation = `${defenders}-${midfielders}-${forwards}` as Formation;
  return FORMATIONS.includes(formation) ? formation : null;
}

export function validateLineup(squad: SquadAsset[], starterIds: number[]) {
  const uniqueIds = new Set(starterIds);
  const starters = squad.filter((player) => uniqueIds.has(player.id));
  const formation = formationForLineup(starters);
  return {
    valid: uniqueIds.size === 11 && starters.length === 11 && formation !== null,
    formation,
    starters,
    bench: squad.filter((player) => !uniqueIds.has(player.id)),
  };
}

export function swapLineupPlayer(
  squad: SquadAsset[],
  starterIds: number[],
  outgoingId: number,
  incomingId: number,
) {
  if (!starterIds.includes(outgoingId) || starterIds.includes(incomingId)) return null;
  const nextIds = starterIds.map((id) => id === outgoingId ? incomingId : id);
  const validation = validateLineup(squad, nextIds);
  return validation.valid ? { starterIds: nextIds, formation: validation.formation! } : null;
}

export function selectBestLineup(squad: SquadAsset[], horizon: 1 | 3 = 1) {
  return FORMATIONS
    .map((formation) => {
      const lineup = selectLineup(squad, formation, horizon);
      const ranked = [...lineup.starters].sort(
        (a, b) => projection(b, horizon) - projection(a, horizon),
      );
      if (ranked.length !== 11) return null;
      const score = ranked.reduce(
        (total, player) => total + projection(player, horizon),
        projection(ranked[0], horizon),
      );
      return {
        formation,
        ...lineup,
        captain: ranked[0],
        viceCaptain: ranked[1],
        score: Number(score.toFixed(3)),
      };
    })
    .filter((lineup): lineup is NonNullable<typeof lineup> => lineup !== null)
    .sort((a, b) => b.score - a.score)[0];
}

function squadProjectionScore(
  squad: SquadAsset[],
  horizon: 1 | 3,
  strategy: SquadStrategy,
) {
  if (strategy === "bench-boost" && horizon === 1) {
    const gameweekOne = squad.reduce((total, player) => total + player.xp1, 0);
    const captain = Math.max(...squad.map((player) => player.xp1));
    const futureCoverage = squad.reduce(
      (total, player) => total + Math.max(0, player.xp3 - player.xp1) * 0.12,
      0,
    );
    return gameweekOne + captain + futureCoverage;
  }
  const lineup = selectBestLineup(squad, horizon);
  if (!lineup) return Number.NEGATIVE_INFINITY;
  const benchWeight = strategy === "bench-boost" ? 1 : 0.08;
  const benchValue = lineup.bench.reduce(
    (total, player) => total + projection(player, horizon) * benchWeight,
    0,
  );
  const tripleCaptainBonus = strategy === "triple-captain"
    ? projection(lineup.captain, horizon)
    : 0;
  return lineup.score + benchValue + tripleCaptainBonus;
}

function candidatePool(players: SquadAsset[], horizon: 1 | 3) {
  return (Object.keys(REQUIRED) as Position[]).flatMap((position) => {
    const positional = players.filter((player) => player.position === position);
    const projected = [...positional]
      .sort((a, b) => projection(b, horizon) - projection(a, horizon))
      .slice(0, 45);
    const cheapest = [...positional]
      .sort((a, b) => a.price - b.price || projection(b, horizon) - projection(a, horizon))
      .slice(0, 12);
    return [...new Map([...projected, ...cheapest].map((player) => [player.id, player])).values()];
  });
}

function reconfigurationPool(
  players: SquadAsset[],
  horizon: 1 | 3,
  strategy: SquadStrategy,
) {
  const assetScore = (player: SquadAsset) =>
    projection(player, horizon)
    + (
      strategy === "bench-boost" && horizon === 1
        ? Math.max(0, player.xp3 - player.xp1) * 0.12
        : 0
    );
  return (Object.keys(REQUIRED) as Position[]).flatMap((position) => {
    const positional = players.filter((player) => player.position === position);
    const projected = [...positional]
      .sort((a, b) => assetScore(b) - assetScore(a))
      .slice(0, 24);
    const cheapest = [...positional]
      .sort((a, b) => a.price - b.price || assetScore(b) - assetScore(a))
      .slice(0, 6);
    return [...new Map([...projected, ...cheapest].map((player) => [player.id, player])).values()];
  });
}

export function optimiseSquad(
  players: SquadAsset[],
  budget = 100,
  horizon: 1 | 3 = 1,
  strategy: SquadStrategy = "standard",
) {
  const usable = players.filter(
    (player) =>
      player.id > 0 &&
      player.team !== "—" &&
      Number.isFinite(player.price) &&
      Number.isFinite(projection(player, horizon)),
  );
  const pool = candidatePool(usable, horizon);
  const pairPool = reconfigurationPool(pool, horizon, strategy);
  const squad: SquadAsset[] = [];

  for (const position of Object.keys(REQUIRED) as Position[]) {
    const positional = pool
      .filter((player) => player.position === position)
      .sort((a, b) => a.price - b.price || projection(b, horizon) - projection(a, horizon));
    for (let index = 0; index < REQUIRED[position]; index += 1) {
      const candidate = positional.find(
        (player) =>
          !squad.some((selected) => selected.id === player.id) &&
          (clubCounts(squad)[player.team] ?? 0) < 3,
      );
      if (!candidate) return null;
      squad.push(candidate);
    }
  }
  if (!validateSquad(squad, budget).valid) return null;

  let current = squad;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const currentScore = squadProjectionScore(current, horizon, strategy);
    let best:
      | { squad: SquadAsset[]; score: number; gain: number; spent: number }
      | undefined;
    for (const outgoing of current) {
      for (const incoming of pool) {
        if (
          incoming.position !== outgoing.position ||
          current.some((player) => player.id === incoming.id)
        ) continue;
        const next = current.map((player) => player.id === outgoing.id ? incoming : player);
        if (!validateSquad(next, budget).valid) continue;
        const score = squadProjectionScore(next, horizon, strategy);
        const gain = score - currentScore;
        const spent = squadCost(next);
        if (
          gain > 0.0001 &&
          (!best || gain > best.gain + 0.0001 || (Math.abs(gain - best.gain) < 0.0001 && spent < best.spent))
        ) {
          best = { squad: next, score, gain, spent };
        }
      }
    }
    if (!best && strategy === "bench-boost" && horizon === 1) {
      for (let firstIndex = 0; firstIndex < current.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < current.length; secondIndex += 1) {
          const firstOutgoing = current[firstIndex];
          const secondOutgoing = current[secondIndex];
          const firstIncomingCandidates = pairPool.filter(
            (player) =>
              player.position === firstOutgoing.position
              && (
                !current.some((selected) => selected.id === player.id)
                || player.id === secondOutgoing.id
              ),
          );
          const secondIncomingCandidates = pairPool.filter(
            (player) =>
              player.position === secondOutgoing.position
              && (
                !current.some((selected) => selected.id === player.id)
                || player.id === firstOutgoing.id
              ),
          );
          for (const firstIncoming of firstIncomingCandidates) {
            for (const secondIncoming of secondIncomingCandidates) {
              if (
                firstIncoming.id === secondIncoming.id
                || (
                  firstIncoming.id === firstOutgoing.id
                  && secondIncoming.id === secondOutgoing.id
                )
              ) continue;
              const next = current.map((player) =>
                player.id === firstOutgoing.id
                  ? firstIncoming
                  : player.id === secondOutgoing.id
                    ? secondIncoming
                    : player,
              );
              if (!validateSquad(next, budget).valid) continue;
              const score = squadProjectionScore(next, horizon, strategy);
              const gain = score - currentScore;
              const spent = squadCost(next);
              if (
                gain > 0.0001
                && (
                  !best
                  || gain > best.gain + 0.0001
                  || (Math.abs(gain - best.gain) < 0.0001 && spent < best.spent)
                )
              ) {
                best = { squad: next, score, gain, spent };
              }
            }
          }
        }
      }
    }
    if (!best) break;
    current = best.squad;
  }

  const lineup = selectBestLineup(current, horizon);
  return lineup ? { squad: current, lineup } : null;
}

export function pitchLayout(starters: SquadAsset[]) {
  const rows: Array<{ position: Position; y: number }> = [
    { position: "GK", y: 9 },
    { position: "DEF", y: 32 },
    { position: "MID", y: 57 },
    { position: "FWD", y: 82 },
  ];
  return rows.flatMap(({ position, y }) => {
    const players = starters.filter((player) => player.position === position);
    return players.map((player, index) => ({
      ...player,
      x: ((index + 1) * 100) / (players.length + 1),
      y,
    }));
  });
}

export function projectedLineupPoints(starters: SquadAsset[], captainId: number | null) {
  const base = starters.reduce((total, player) => total + player.xp1, 0);
  const captain = starters.find((player) => player.id === captainId);
  return Number((base + (captain?.xp1 ?? 0)).toFixed(1));
}

export function projectedStrategyPoints(
  starters: SquadAsset[],
  bench: SquadAsset[],
  captainId: number | null,
  strategy: SquadStrategy,
) {
  const base = projectedLineupPoints(starters, captainId);
  const captain = starters.find((player) => player.id === captainId);
  const benchPoints = strategy === "bench-boost"
    ? bench.reduce((total, player) => total + player.xp1, 0)
    : 0;
  const tripleCaptainBonus = strategy === "triple-captain"
    ? captain?.xp1 ?? 0
    : 0;
  return Number((base + benchPoints + tripleCaptainBonus).toFixed(1));
}

export function resolveCaptaincy(starters: SquadAsset[], preferredCaptainId: number | null, preferredViceId: number | null) {
  const ranked = [...starters].sort((a, b) => b.xp1 - a.xp1);
  const captainId = starters.some((player) => player.id === preferredCaptainId)
    ? preferredCaptainId
    : ranked[0]?.id ?? null;
  const viceCaptainId = starters.some((player) => player.id === preferredViceId && player.id !== captainId)
    ? preferredViceId
    : ranked.find((player) => player.id !== captainId)?.id ?? null;
  return { captainId, viceCaptainId };
}
