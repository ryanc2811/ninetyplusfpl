/**
 * League contracts.
 *
 * A manager is identified only by their public FPL team ID. No credential of
 * any kind is accepted, stored or forwarded.
 */

export type LeagueType = "invitational" | "system";

export type LeagueSummary = {
  id: number;
  name: string;
  /** Invitational leagues are the ones a manager chose to join. */
  type: LeagueType;
  /** The manager's current rank in this league, when the season has started. */
  rank: number | null;
  lastRank: number | null;
  entryCount: number | null;
  startEvent: number;
};

export type ManagerSummary = {
  entryId: number;
  teamName: string;
  managerName: string;
  regionName: string | null;
  startedEvent: number;
  overallPoints: number | null;
  overallRank: number | null;
  yearsActive: number | null;
};

/** One Gameweek of a manager's season, as published by the official feed. */
export type ManagerGameweek = {
  event: number;
  /** Gameweek score before the transfer cost is applied. */
  points: number;
  netPoints: number;
  totalPoints: number;
  overallRank: number | null;
  transfers: number;
  transferCost: number;
  pointsOnBench: number;
  squadValue: number;
  bank: number;
};

export type ManagerSeason = {
  entryId: number;
  teamName: string;
  managerName: string;
  gameweeks: ManagerGameweek[];
};

/** A calendar month, expressed as the Gameweek range the official feed defines. */
export type MonthWindow = {
  phaseId: number;
  name: string;
  startEvent: number;
  stopEvent: number;
  /** True once every Gameweek in the window has been scored and checked. */
  complete: boolean;
  /** True when the window contains the Gameweek currently being played. */
  current: boolean;
  gameweeksPlayed: number;
};

/** One scored Gameweek inside a month window. */
export type MonthGameweek = {
  event: number;
  /** Gameweek score before the transfer cost is applied. */
  points: number;
  netPoints: number;
};

export type MonthlyStanding = {
  entryId: number;
  teamName: string;
  managerName: string;
  rank: number;
  /** Net of transfer costs, which is how a month is actually won. */
  netPoints: number;
  grossPoints: number;
  transferCost: number;
  pointsOnBench: number;
  gameweeksCounted: number;
  /**
   * Rank as it stood before the most recent scored Gameweek, which is what the
   * movement arrow compares against. Null when only one Gameweek has counted,
   * because nothing has moved yet.
   */
  previousRank: number | null;
  /** Every scored Gameweek of the month, in order. */
  gameweeks: MonthGameweek[];
};

export type MonthlyResult = {
  month: MonthWindow;
  standings: MonthlyStanding[];
};

export type BadgeKind =
  | "manager-of-the-month"
  | "bench-regret"
  | "hit-taker"
  | "most-consistent"
  | "best-gameweek";

export type Badge = {
  kind: BadgeKind;
  label: string;
  /** Month name for monthly badges, or "Season" for season-long awards. */
  period: string;
  entryId: number;
  teamName: string;
  managerName: string;
  value: number;
  unit: string;
  detail: string;
};

export type ManagerInsight = {
  entryId: number;
  teamName: string;
  managerName: string;
  totalPoints: number;
  benchPoints: number;
  transferCost: number;
  bestGameweek: { event: number; points: number } | null;
  worstGameweek: { event: number; points: number } | null;
  /** Standard deviation of net Gameweek scores. Lower is steadier. */
  consistency: number | null;
  greenArrows: number;
  monthsWon: number;
};

export type LeagueInsightsResponse = {
  league: {
    id: number;
    name: string;
    type: LeagueType;
    entryCount: number;
    /** True when the league has more entries than the analysed sample. */
    truncated: boolean;
    analysedCount: number;
  };
  /** Gameweeks scored and data-checked at the time of retrieval. */
  completedGameweeks: number;
  months: MonthlyResult[];
  /**
   * Month windows that have not started. The interface needs them to show the
   * next month as an empty state rather than pretending it does not exist.
   */
  upcomingMonths: MonthWindow[];
  badges: Badge[];
  managers: ManagerInsight[];
  provenance: {
    source: string;
    retrievedAt: string;
    requestUrls: string[];
  };
};

export type ManagerLeaguesResponse = {
  manager: ManagerSummary;
  leagues: LeagueSummary[];
};
