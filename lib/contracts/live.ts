/**
 * Live Gameweek contracts.
 *
 * A Gameweek in progress is not in a manager's history yet, so a month total
 * that only reads history is stale from the first kickoff until the bonus is
 * confirmed. These types carry the in-progress part: what every player has
 * scored so far, and what each manager's picks make of it.
 *
 * As everywhere else, a manager is identified by their public team ID. No
 * credential is accepted, stored or forwarded.
 */

/** One player's live return in the Gameweek being played. */
export type LivePlayerPoints = {
  playerId: number;
  points: number;
  minutes: number;
  /** The official feed's own flag: the player has appeared. */
  played: boolean;
};

export type LiveEventStatus = {
  event: number;
  started: boolean;
  finished: boolean;
  /** Bonus confirmed and the Gameweek locked, which is when history is final. */
  dataChecked: boolean;
};

/** A starter whose fixture has not finished. */
export type PlayerToPlay = {
  playerId: number;
  name: string;
  team: string;
  fixture: string;
  kickoff: string | null;
  /** 2 for a captain, 3 under Triple Captain. */
  multiplier: number;
};

export type LiveManager = {
  entryId: number;
  /** Live Gameweek score with captain multipliers applied, before hits. */
  points: number;
  /** Net of this Gameweek's transfer cost, which is how a month is scored. */
  netPoints: number;
  transferCost: number;
  playersPlayed: number;
  playersToPlay: number;
  toPlay: PlayerToPlay[];
  activeChip: string | null;
};

export type LeagueLiveResponse = {
  event: number;
  started: boolean;
  finished: boolean;
  dataChecked: boolean;
  /** When this snapshot was taken, for the "updated Xs ago" label. */
  retrievedAt: string;
  managers: LiveManager[];
  provenance: { source: string; requestUrls: string[] };
};

/** One side of a head-to-head: the picks that can still change the result. */
export type DifferentialPlayer = {
  playerId: number;
  name: string;
  team: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  points: number;
  /** The multiplier each manager applies, so a shared captain is not a wash. */
  yourMultiplier: number;
  theirMultiplier: number;
  /** Points this player has actually swung, your side minus theirs. */
  swing: number;
  status: "To play" | "Playing" | "Played";
  fixture: string;
  kickoff: string | null;
};

export type HeadToHeadResponse = {
  event: number;
  started: boolean;
  finished: boolean;
  retrievedAt: string;
  you: { entryId: number; teamName: string; managerName: string; points: number; netPoints: number; transferCost: number };
  them: { entryId: number; teamName: string; managerName: string; points: number; netPoints: number; transferCost: number };
  /** Both own them with the same multiplier, so they cancel out. */
  shared: { count: number; points: number };
  captaincy: DifferentialPlayer[];
  onlyYou: DifferentialPlayer[];
  onlyThem: DifferentialPlayer[];
  provenance: { source: string; requestUrls: string[] };
};

/** A manager's own squad, as the official game currently holds it. */
export type EntrySquadResponse = {
  entryId: number;
  teamName: string;
  managerName: string;
  event: number;
  /** True once the Gameweek these picks belong to has been played out. */
  finished: boolean;
  activeChip: string | null;
  bank: number;
  squadValue: number;
  picks: Array<{
    playerId: number;
    position: number;
    multiplier: number;
    isCaptain: boolean;
    isViceCaptain: boolean;
  }>;
};
