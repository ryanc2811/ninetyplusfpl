import type {
  LeagueSummary,
  LeagueType,
  ManagerGameweek,
  ManagerSeason,
  ManagerSummary,
} from "../contracts/leagues.ts";
import type { EventStatus, RawPhase } from "../league-insights.ts";
import { fetchFpl } from "./fpl-request.ts";

/**
 * Official FPL league adapter.
 *
 * Building league insights costs one request per manager, because per-Gameweek
 * detail (bench points, transfer costs, chip usage) only exists on the
 * per-entry history endpoint. Three protections keep that from becoming abusive
 * toward a public API:
 *
 * - `maxManagers` caps how many entries are analysed for one league;
 * - requests run at bounded concurrency rather than all at once;
 * - a failed manager fetch is skipped rather than retried in a loop.
 *
 * No credential is ever accepted. A manager is identified by their public team
 * ID alone.
 */

const BASE = "https://fantasy.premierleague.com/api";

export type LeagueStandingEntry = {
  entryId: number;
  teamName: string;
  managerName: string;
  rank: number;
  lastRank: number;
  total: number;
  eventTotal: number;
};

export type LeagueStandings = {
  id: number;
  name: string;
  type: LeagueType;
  entries: LeagueStandingEntry[];
  /** True when the league has more pages than were retrieved. */
  truncated: boolean;
  requestUrls: string[];
};

export type SeasonCalendar = {
  phases: RawPhase[];
  events: EventStatus[];
  completedGameweeks: number;
};

export interface FplLeagueProvider {
  loadManager(entryId: number): Promise<ManagerSummary>;
  loadManagerLeagues(entryId: number): Promise<{ manager: ManagerSummary; leagues: LeagueSummary[] }>;
  loadStandings(leagueId: number, maxManagers: number): Promise<LeagueStandings>;
  loadManagerSeasons(entries: LeagueStandingEntry[]): Promise<ManagerSeason[]>;
  loadCalendar(): Promise<SeasonCalendar>;
}

type RawEntry = {
  id: number;
  name: string;
  player_first_name: string;
  player_last_name: string;
  player_region_name: string | null;
  started_event: number;
  summary_overall_points: number | null;
  summary_overall_rank: number | null;
  years_active: number | null;
  leagues?: { classic?: RawLeague[] };
};

type RawLeague = {
  id: number;
  name: string;
  league_type: string;
  entry_rank: number | null;
  entry_last_rank: number | null;
  rank_count: number | null;
  start_event: number;
};

type RawStandingsPage = {
  league: { id: number; name: string; league_type: string };
  standings: {
    has_next: boolean;
    page: number;
    results: Array<{
      entry: number;
      entry_name: string;
      player_name: string;
      rank: number;
      last_rank: number;
      total: number;
      event_total: number;
    }>;
  };
};

type RawHistory = {
  current: Array<{
    event: number;
    points: number;
    total_points: number;
    overall_rank: number | null;
    event_transfers: number;
    event_transfers_cost: number;
    points_on_bench: number;
    value: number;
    bank: number;
  }>;
};

function numeric(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** FPL marks invitational leagues `x` and auto-joined system leagues `s`. */
function leagueType(raw: string): LeagueType {
  return raw === "x" ? "invitational" : "system";
}

/** Runs tasks with a fixed worker pool so a large league cannot burst. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R | null>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const outcome = await worker(items[index]);
      if (outcome !== null) results.push(outcome);
    }
  });
  await Promise.all(runners);
  return results;
}

function toManagerSummary(raw: RawEntry): ManagerSummary {
  return {
    entryId: numeric(raw.id),
    teamName: String(raw.name ?? "Unnamed team"),
    managerName: `${raw.player_first_name ?? ""} ${raw.player_last_name ?? ""}`.trim(),
    regionName: raw.player_region_name ?? null,
    startedEvent: numeric(raw.started_event, 1),
    overallPoints: raw.summary_overall_points ?? null,
    overallRank: raw.summary_overall_rank ?? null,
    yearsActive: raw.years_active ?? null,
  };
}

export class OfficialFplLeagueProvider implements FplLeagueProvider {
  private readonly concurrency: number;

  constructor(concurrency = 4) {
    this.concurrency = concurrency;
  }

  async loadManager(entryId: number): Promise<ManagerSummary> {
    return toManagerSummary(await fetchFpl<RawEntry>(`${BASE}/entry/${entryId}/`, 900));
  }

  async loadCalendar(): Promise<SeasonCalendar> {
    const data = await fetchFpl<{ phases: RawPhase[]; events: EventStatus[] }>(
      `${BASE}/bootstrap-static/`,
      1_800,
    );
    const events = data.events ?? [];
    return {
      phases: data.phases ?? [],
      events,
      completedGameweeks: events.filter((event) => event.finished && event.data_checked).length,
    };
  }

  async loadManagerLeagues(entryId: number) {
    const raw = await fetchFpl<RawEntry>(`${BASE}/entry/${entryId}/`, 900);
    const leagues = (raw.leagues?.classic ?? []).map<LeagueSummary>((league) => ({
      id: numeric(league.id),
      name: String(league.name),
      type: leagueType(league.league_type),
      rank: league.entry_rank ?? null,
      lastRank: league.entry_last_rank ?? null,
      entryCount: league.rank_count ?? null,
      startEvent: numeric(league.start_event, 1),
    }));
    return { manager: toManagerSummary(raw), leagues };
  }

  async loadStandings(leagueId: number, maxManagers: number): Promise<LeagueStandings> {
    const entries: LeagueStandingEntry[] = [];
    const requestUrls: string[] = [];
    let page = 1;
    let hasNext = true;
    let name = `League ${leagueId}`;
    let type: LeagueType = "system";

    // Standings paginate at 50. Stop as soon as the analysis cap is reached.
    while (hasNext && entries.length < maxManagers) {
      const url = `${BASE}/leagues-classic/${leagueId}/standings/?page_standings=${page}`;
      requestUrls.push(url);
      const data = await fetchFpl<RawStandingsPage>(url, 900);
      name = String(data.league?.name ?? name);
      type = leagueType(data.league?.league_type ?? "s");
      for (const result of data.standings?.results ?? []) {
        entries.push({
          entryId: numeric(result.entry),
          teamName: String(result.entry_name ?? "Unnamed team"),
          managerName: String(result.player_name ?? ""),
          rank: numeric(result.rank),
          lastRank: numeric(result.last_rank),
          total: numeric(result.total),
          eventTotal: numeric(result.event_total),
        });
      }
      hasNext = Boolean(data.standings?.has_next);
      page += 1;
    }

    return {
      id: leagueId,
      name,
      type,
      entries: entries.slice(0, maxManagers),
      truncated: hasNext,
      requestUrls,
    };
  }

  /**
   * Finds managers in a league by team or manager name.
   *
   * The official API has no team search of its own, so this pages the public
   * standings and filters them here. Pages are capped: a search is a
   * convenience, not a reason to walk a league of a million entries.
   */
  async searchEntries(
    leagueId: number,
    query: string,
    maxPages = 20,
  ): Promise<{
    name: string;
    matches: LeagueStandingEntry[];
    scanned: number;
    truncated: boolean;
  }> {
    const needle = query.trim().toLowerCase();
    const matches: LeagueStandingEntry[] = [];
    let name = `League ${leagueId}`;
    let scanned = 0;
    let page = 1;
    let hasNext = true;

    while (hasNext && page <= maxPages && matches.length < 25) {
      const data = await fetchFpl<RawStandingsPage>(
        `${BASE}/leagues-classic/${leagueId}/standings/?page_standings=${page}`,
        900,
      );
      name = String(data.league?.name ?? name);
      for (const result of data.standings?.results ?? []) {
        scanned += 1;
        const teamName = String(result.entry_name ?? "");
        const managerName = String(result.player_name ?? "");
        if (
          !needle
          || teamName.toLowerCase().includes(needle)
          || managerName.toLowerCase().includes(needle)
        ) {
          matches.push({
            entryId: numeric(result.entry),
            teamName,
            managerName,
            rank: numeric(result.rank),
            lastRank: numeric(result.last_rank),
            total: numeric(result.total),
            eventTotal: numeric(result.event_total),
          });
        }
      }
      hasNext = Boolean(data.standings?.has_next);
      page += 1;
    }

    return { name, matches: matches.slice(0, 25), scanned, truncated: hasNext };
  }

  async loadManagerSeasons(entries: LeagueStandingEntry[]): Promise<ManagerSeason[]> {
    return mapWithConcurrency(entries, this.concurrency, async (entry) => {
      try {
        const history = await fetchFpl<RawHistory>(
          `${BASE}/entry/${entry.entryId}/history/`,
          900,
        );
        const gameweeks = (history.current ?? []).map<ManagerGameweek>((week) => {
          const points = numeric(week.points);
          const transferCost = numeric(week.event_transfers_cost);
          return {
            event: numeric(week.event),
            points,
            netPoints: points - transferCost,
            totalPoints: numeric(week.total_points),
            overallRank: week.overall_rank ?? null,
            transfers: numeric(week.event_transfers),
            transferCost,
            pointsOnBench: numeric(week.points_on_bench),
            squadValue: numeric(week.value) / 10,
            bank: numeric(week.bank) / 10,
          };
        });
        return {
          entryId: entry.entryId,
          teamName: entry.teamName,
          managerName: entry.managerName,
          gameweeks,
        };
      } catch {
        // A single unavailable manager must not fail the whole league view.
        return null;
      }
    });
  }
}
