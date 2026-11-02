import type { Position } from "./contracts/fpl.ts";
import { FORMATIONS, type Formation } from "./squad-builder.ts";
import type { EntryPicks } from "./providers/live-provider.ts";

/**
 * Automatic substitutions.
 *
 * A starter who plays no minutes is replaced by the first bench player who
 * can take their place, and the bench is read left to right. "Can take their
 * place" is the whole rule: the eleven that results has to be a formation the
 * game allows, so a defender who blanks out of a 3-5-2 can only be replaced
 * by another defender even when a midfielder is further left on the bench.
 * The goalkeeper is a special case — only the bench goalkeeper can replace
 * them — and if the captain blanks, the armband moves to the vice-captain.
 *
 * The official feed publishes these substitutions once a Gameweek is over.
 * While one is in progress it publishes none, so a live score that ignores
 * the bench is wrong for every manager whose starter did not turn up. This
 * projects them from what has actually happened so far: a starter is only
 * substituted once their own fixture is over, and a bench player can only
 * come on once they have played.
 */

export type SubstitutionContext = {
  position: (playerId: number) => Position | null;
  minutes: (playerId: number) => number;
  /** True once that player's fixture can produce no more minutes. */
  fixtureIsOver: (playerId: number) => boolean;
};

export type Substitution = { out: number; in: number };

export type AppliedSubs = {
  /** The multiplier each player is scoring on after substitutions. */
  multipliers: Map<number, number>;
  substitutions: Substitution[];
  /** True when the armband moved because the captain did not play. */
  captainMoved: boolean;
  /** True when these came from the official feed rather than being projected. */
  official: boolean;
};

const STARTING_POSITIONS = 11;

function shapeOf(positions: Position[]): Formation | null {
  const count = (position: Position) => positions.filter((entry) => entry === position).length;
  if (count("GK") !== 1 || positions.length !== STARTING_POSITIONS) return null;
  const shape = `${count("DEF")}-${count("MID")}-${count("FWD")}` as Formation;
  return FORMATIONS.includes(shape) ? shape : null;
}

/** A legal eleven is one of the shapes the game actually allows. */
export function isLegalEleven(positions: Position[]) {
  return shapeOf(positions) !== null;
}

/**
 * Works out which substitutions the game will make, and what each player ends
 * up scoring on.
 */
export function applyAutomaticSubs(
  picks: EntryPicks,
  context: SubstitutionContext,
): AppliedSubs {
  const multipliers = new Map(picks.picks.map((pick) => [pick.playerId, pick.multiplier]));

  // Once the Gameweek is over the feed publishes the real substitutions, and
  // those are the answer — no projection can beat them.
  const official = picks.automaticSubs.length > 0;

  // The eleven is the picks carrying a multiplier; the bench is the rest, in
  // the order the manager left them. Reading it this way rather than by slot
  // number keeps a chip or a short squad from being mistaken for a bench.
  const byPosition = [...picks.picks].sort((a, b) => a.position - b.position);
  const starters = byPosition.filter((pick) => pick.multiplier > 0);
  const bench = byPosition.filter((pick) => pick.multiplier === 0);

  const positionOf = (playerId: number) => context.position(playerId);
  const blanked = (playerId: number) =>
    context.fixtureIsOver(playerId) && context.minutes(playerId) === 0;
  const hasPlayed = (playerId: number) => context.minutes(playerId) > 0;

  // The eleven as it stands, which every candidate substitution is checked
  // against so the formation never becomes one the game would not allow.
  const eleven = starters.map((pick) => pick.playerId);
  const usedFromBench = new Set<number>();
  const substitutions: Substitution[] = official
    ? picks.automaticSubs.map((sub) => ({ out: sub.out, in: sub.in }))
    : [];

  for (const starter of official ? [] : starters) {
    if (!blanked(starter.playerId)) continue;
    const out = positionOf(starter.playerId);
    if (!out) continue;

    for (const candidate of bench) {
      if (usedFromBench.has(candidate.playerId)) continue;
      if (!hasPlayed(candidate.playerId)) continue;
      const incoming = positionOf(candidate.playerId);
      if (!incoming) continue;
      // Only the bench goalkeeper can replace the goalkeeper, and a
      // goalkeeper is no use anywhere else.
      if ((out === "GK") !== (incoming === "GK")) continue;

      const next = eleven.map((playerId) =>
        playerId === starter.playerId ? candidate.playerId : playerId,
      );
      const positions = next
        .map((playerId) => positionOf(playerId))
        .filter((position): position is Position => position !== null);
      if (positions.length !== STARTING_POSITIONS || !isLegalEleven(positions)) continue;

      eleven[eleven.indexOf(starter.playerId)] = candidate.playerId;
      usedFromBench.add(candidate.playerId);
      substitutions.push({ out: starter.playerId, in: candidate.playerId });
      break;
    }
  }

  // A substitute always comes on at a single multiplier: the armband never
  // travels with the substitution, it passes to the vice-captain.
  for (const sub of substitutions) {
    multipliers.set(sub.out, 0);
    multipliers.set(sub.in, 1);
  }

  /*
   * The armband moves when the captain has played no part. The vice only
   * takes it if they can still score: already playing, or yet to kick off.
   * If both blank, the double is simply lost, which is what the game does.
   */
  let captainMoved = false;
  const captain = picks.picks.find((pick) => pick.isCaptain);
  const vice = picks.picks.find((pick) => pick.isViceCaptain);
  if (
    captain
    && vice
    && captain.multiplier > 1
    && blanked(captain.playerId)
    && !blanked(vice.playerId)
    && (multipliers.get(vice.playerId) ?? 0) > 0
  ) {
    multipliers.set(captain.playerId, 0);
    multipliers.set(vice.playerId, captain.multiplier);
    captainMoved = true;
  }

  return { multipliers, substitutions, captainMoved, official };
}
