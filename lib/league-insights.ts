import type {
  Badge,
  ManagerInsight,
  ManagerSeason,
  MonthlyResult,
  MonthlyStanding,
  MonthWindow,
} from "./contracts/leagues.ts";

/**
 * League insight calculations.
 *
 * Calendar months are not derived from kickoff dates. The official bootstrap
 * payload publishes a `phases` array that is exactly FPL's own month-to-
 * Gameweek mapping (August = GW1-2, September = GW3-5, and so on), so using it
 * means a Manager of the Month award covers the same Gameweeks as the official
 * one rather than a range this application invented.
 *
 * A month is scored on **net** points. Transfer costs are deducted, because
 * that is how a month is actually won or lost.
 */

/** Phase 1 is the whole season, not a month. */
const OVERALL_PHASE_ID = 1;

export type RawPhase = {
  id: number;
  name: string;
  start_event: number;
  stop_event: number;
};

export type EventStatus = {
  id: number;
  finished: boolean;
  data_checked: boolean;
};

function isScored(event: EventStatus | undefined) {
  return Boolean(event?.finished && event.data_checked);
}

/**
 * Converts the official phases into month windows, annotated with how much of
 * each month has actually been scored.
 */
export function monthWindows(phases: RawPhase[], events: EventStatus[]): MonthWindow[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  const scoredEvents = events.filter(isScored).map((event) => event.id);
  const latestScored = scoredEvents.length ? Math.max(...scoredEvents) : 0;

  return phases
    .filter((phase) => phase.id !== OVERALL_PHASE_ID)
    .map((phase) => {
      const range = gameweekRange(phase.start_event, phase.stop_event);
      const played = range.filter((event) => isScored(byId.get(event)));
      return {
        phaseId: phase.id,
        name: phase.name,
        startEvent: phase.start_event,
        stopEvent: phase.stop_event,
        complete: played.length === range.length && range.length > 0,
        current:
          (played.length > 0 && played.length < range.length)
          // A month with nothing scored yet is only current if it is next up.
          || (played.length === 0 && phase.start_event === latestScored + 1),
        gameweeksPlayed: played.length,
      };
    });
}

function gameweekRange(start: number, stop: number) {
  if (stop < start) return [];
  return Array.from({ length: stop - start + 1 }, (_, index) => start + index);
}

/**
 * Ranks managers within one month window. Ties share a rank, and the next rank
 * skips accordingly.
 */
export function monthlyStandings(
  month: MonthWindow,
  seasons: ManagerSeason[],
): MonthlyStanding[] {
  const range = new Set(gameweekRange(month.startEvent, month.stopEvent));
  const rows = seasons.map((season) => {
    const weeks = season.gameweeks.filter((week) => range.has(week.event));
    const grossPoints = weeks.reduce((sum, week) => sum + week.points, 0);
    const transferCost = weeks.reduce((sum, week) => sum + week.transferCost, 0);
    return {
      entryId: season.entryId,
      teamName: season.teamName,
      managerName: season.managerName,
      rank: 0,
      netPoints: grossPoints - transferCost,
      grossPoints,
      transferCost,
      pointsOnBench: weeks.reduce((sum, week) => sum + week.pointsOnBench, 0),
      gameweeksCounted: weeks.length,
    };
  });

  rows.sort((a, b) => b.netPoints - a.netPoints || a.teamName.localeCompare(b.teamName));
  let rank = 0;
  let previousPoints: number | null = null;
  rows.forEach((row, index) => {
    if (previousPoints === null || row.netPoints !== previousPoints) {
      rank = index + 1;
      previousPoints = row.netPoints;
    }
    row.rank = rank;
  });
  return rows;
}

export function monthlyResults(
  phases: RawPhase[],
  events: EventStatus[],
  seasons: ManagerSeason[],
): MonthlyResult[] {
  return monthWindows(phases, events)
    .filter((month) => month.gameweeksPlayed > 0)
    .map((month) => ({ month, standings: monthlyStandings(month, seasons) }));
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Number(Math.sqrt(variance).toFixed(2));
}

export function managerInsights(
  seasons: ManagerSeason[],
  months: MonthlyResult[],
): ManagerInsight[] {
  const monthsWonByEntry = new Map<number, number>();
  for (const result of months) {
    if (!result.month.complete) continue;
    for (const standing of result.standings.filter((row) => row.rank === 1)) {
      monthsWonByEntry.set(
        standing.entryId,
        (monthsWonByEntry.get(standing.entryId) ?? 0) + 1,
      );
    }
  }

  return seasons.map((season) => {
    const weeks = season.gameweeks;
    const sorted = [...weeks].sort((a, b) => b.netPoints - a.netPoints);
    let greenArrows = 0;
    for (let index = 1; index < weeks.length; index += 1) {
      const previous = weeks[index - 1].overallRank;
      const current = weeks[index].overallRank;
      if (previous !== null && current !== null && current < previous) greenArrows += 1;
    }
    return {
      entryId: season.entryId,
      teamName: season.teamName,
      managerName: season.managerName,
      totalPoints: weeks.reduce((sum, week) => sum + week.netPoints, 0),
      benchPoints: weeks.reduce((sum, week) => sum + week.pointsOnBench, 0),
      transferCost: weeks.reduce((sum, week) => sum + week.transferCost, 0),
      bestGameweek: sorted.length
        ? { event: sorted[0].event, points: sorted[0].netPoints }
        : null,
      worstGameweek: sorted.length
        ? {
            event: sorted[sorted.length - 1].event,
            points: sorted[sorted.length - 1].netPoints,
          }
        : null,
      consistency: standardDeviation(weeks.map((week) => week.netPoints)),
      greenArrows,
      monthsWon: monthsWonByEntry.get(season.entryId) ?? 0,
    };
  });
}

function leader<T>(rows: T[], score: (row: T) => number): T[] {
  if (!rows.length) return [];
  const best = Math.max(...rows.map(score));
  return rows.filter((row) => score(row) === best);
}

/**
 * Awards badges. Manager of the Month is only awarded for months whose every
 * Gameweek has been scored and data-checked, so a badge never appears and then
 * changes hands after provisional bonus is confirmed.
 */
export function awardBadges(
  months: MonthlyResult[],
  insights: ManagerInsight[],
): Badge[] {
  const badges: Badge[] = [];

  for (const result of months) {
    if (!result.month.complete) continue;
    const winners = result.standings.filter((row) => row.rank === 1 && row.netPoints > 0);
    for (const winner of winners) {
      badges.push({
        kind: "manager-of-the-month",
        label: "Manager of the Month",
        period: result.month.name,
        entryId: winner.entryId,
        teamName: winner.teamName,
        managerName: winner.managerName,
        value: winner.netPoints,
        unit: "pts",
        detail:
          `${winner.netPoints} net points across GW${result.month.startEvent}`
          + `${result.month.stopEvent !== result.month.startEvent ? `-${result.month.stopEvent}` : ""}`
          + (winner.transferCost > 0 ? ` after ${winner.transferCost} in hits` : "")
          + (winners.length > 1 ? " (shared)" : ""),
      });
    }
  }

  const played = insights.filter((insight) => insight.bestGameweek !== null);
  if (!played.length) return badges;

  for (const winner of leader(played, (insight) => insight.bestGameweek?.points ?? 0)) {
    badges.push({
      kind: "best-gameweek",
      label: "Best Gameweek",
      period: "Season",
      entryId: winner.entryId,
      teamName: winner.teamName,
      managerName: winner.managerName,
      value: winner.bestGameweek?.points ?? 0,
      unit: "pts",
      detail: `Highest single Gameweek in the league, in GW${winner.bestGameweek?.event}`,
    });
  }

  for (const winner of leader(played, (insight) => insight.benchPoints)) {
    if (winner.benchPoints <= 0) break;
    badges.push({
      kind: "bench-regret",
      label: "Bench Regret",
      period: "Season",
      entryId: winner.entryId,
      teamName: winner.teamName,
      managerName: winner.managerName,
      value: winner.benchPoints,
      unit: "pts",
      detail: "Most points left on the bench this season",
    });
  }

  for (const winner of leader(played, (insight) => insight.transferCost)) {
    if (winner.transferCost <= 0) break;
    badges.push({
      kind: "hit-taker",
      label: "Hit Taker",
      period: "Season",
      entryId: winner.entryId,
      teamName: winner.teamName,
      managerName: winner.managerName,
      value: winner.transferCost,
      unit: "pts",
      detail: "Most points spent on transfer costs",
    });
  }

  // Consistency needs at least two scored Gameweeks to mean anything.
  const measurable = played.filter((insight) => insight.consistency !== null);
  for (const winner of leader(measurable, (insight) => -(insight.consistency ?? 0))) {
    badges.push({
      kind: "most-consistent",
      label: "Most Consistent",
      period: "Season",
      entryId: winner.entryId,
      teamName: winner.teamName,
      managerName: winner.managerName,
      value: winner.consistency ?? 0,
      unit: "sd",
      detail: "Smallest swing between Gameweek scores",
    });
  }

  return badges;
}

export const LEAGUE_INSIGHTS_VERSION = "league-insights-v1";
