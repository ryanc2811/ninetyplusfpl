import type { LiveEventStatus, LivePlayerPoints } from "../contracts/live.ts";
import { fetchFpl } from "./fpl-request.ts";

/**
 * Official FPL live adapter.
 *
 * Polling a live Gameweek is the one place this application could become a
 * burden on a public API, so the request pattern is deliberate:
 *
 * - `event/{n}/live/` is **one** request for every player in the game, so a
 *   poll costs one call no matter how many managers are being followed;
 * - a manager's picks are frozen at the deadline — only auto-substitutions and
 *   the vice-captain promotion change them, and both land at the end of the
 *   Gameweek — so picks are cached for far longer than the poll interval;
 * - every response is cached by the platform under its own revalidate window,
 *   so several managers watching the same league share one upstream call.
 */

const BASE = "https://fantasy.premierleague.com/api";

/** A poll is only worth making this often; the feed itself moves in minutes. */
const LIVE_TTL = 30;
/** Picks change at the deadline and then at the Gameweek's end, not between. */
const PICKS_TTL = 600;
const FIXTURES_TTL = 60;
const BOOTSTRAP_TTL = 300;

export type EntryPick = {
  playerId: number;
  position: number;
  multiplier: number;
  isCaptain: boolean;
  isViceCaptain: boolean;
};

export type EntryPicks = {
  entryId: number;
  event: number;
  picks: EntryPick[];
  activeChip: string | null;
  /** Applied by the official game at the end of the Gameweek, not during it. */
  automaticSubs: Array<{ out: number; in: number }>;
  points: number;
  transferCost: number;
  /** In millions, as the squad builder's budget is expressed. */
  bank: number;
  squadValue: number;
};

export type LiveFixture = {
  id: number;
  homeTeam: number;
  awayTeam: number;
  started: boolean;
  /** Only true once bonus is confirmed, which can be a day after full time. */
  finished: boolean;
  /** The 90 minutes are up. This is what "still to play" has to read. */
  finishedProvisional: boolean;
  kickoff: string | null;
};

export type LivePlayerMeta = {
  playerId: number;
  name: string;
  team: number;
  teamShort: string;
  position: "GK" | "DEF" | "MID" | "FWD";
};

export interface FplLiveProvider {
  loadEventStatus(): Promise<LiveEventStatus | null>;
  loadLivePoints(event: number): Promise<LivePlayerPoints[]>;
  loadPicks(entryId: number, event: number): Promise<EntryPicks | null>;
  loadFixtures(event: number): Promise<LiveFixture[]>;
  loadPlayerMeta(): Promise<LivePlayerMeta[]>;
  readonly requestUrls: string[];
}

const POSITIONS: Record<number, LivePlayerMeta["position"]> = {
  1: "GK",
  2: "DEF",
  3: "MID",
  4: "FWD",
};

type RawEvent = {
  id: number;
  is_current?: boolean;
  is_next?: boolean;
  finished: boolean;
  data_checked: boolean;
};

type RawBootstrap = {
  events: RawEvent[];
  elements: Array<{ id: number; web_name: string; team: number; element_type: number }>;
  teams: Array<{ id: number; short_name: string }>;
};

type RawLive = {
  elements: Array<{
    id: number;
    stats: { total_points: number; minutes: number; played?: boolean; bps?: number; bonus?: number };
    explain?: Array<{ fixture: number }>;
  }>;
};

type RawPicks = {
  active_chip: string | null;
  automatic_subs: Array<{ element_in: number; element_out: number }>;
  entry_history: {
    points: number;
    event_transfers_cost: number;
    bank: number;
    value: number;
  };
  picks: Array<{
    element: number;
    position: number;
    multiplier: number;
    is_captain: boolean;
    is_vice_captain: boolean;
  }>;
};

type RawFixture = {
  id: number;
  team_h: number;
  team_a: number;
  started: boolean | null;
  finished: boolean;
  finished_provisional?: boolean;
  kickoff_time: string | null;
};

export class OfficialFplLiveProvider implements FplLiveProvider {
  readonly requestUrls: string[] = [];
  private readonly concurrency: number;

  constructor(concurrency = 4) {
    this.concurrency = concurrency;
  }

  private async fetchJson<T>(url: string, revalidate: number): Promise<T> {
    this.requestUrls.push(url);
    return fetchFpl<T>(url, revalidate);
  }

  /** The Gameweek being played, or the one just finished while bonus settles. */
  async loadEventStatus(): Promise<LiveEventStatus | null> {
    const data = await this.fetchJson<RawBootstrap>(`${BASE}/bootstrap-static/`, BOOTSTRAP_TTL);
    const current = data.events?.find((event) => event.is_current)
      ?? [...(data.events ?? [])].reverse().find((event) => event.finished);
    if (!current) return null;
    return {
      event: current.id,
      // A current Gameweek the official feed has not finished is in progress.
      started: true,
      finished: Boolean(current.finished),
      dataChecked: Boolean(current.data_checked),
    };
  }

  async loadPlayerMeta(): Promise<LivePlayerMeta[]> {
    const data = await this.fetchJson<RawBootstrap>(`${BASE}/bootstrap-static/`, BOOTSTRAP_TTL);
    const teams = new Map((data.teams ?? []).map((team) => [team.id, team.short_name]));
    return (data.elements ?? []).map((element) => ({
      playerId: element.id,
      name: element.web_name,
      team: element.team,
      teamShort: teams.get(element.team) ?? "",
      position: POSITIONS[element.element_type] ?? "MID",
    }));
  }

  /** One request covers every player in the game. */
  async loadLivePoints(event: number): Promise<LivePlayerPoints[]> {
    const data = await this.fetchJson<RawLive>(`${BASE}/event/${event}/live/`, LIVE_TTL);
    return (data.elements ?? []).map((element) => ({
      playerId: element.id,
      points: element.stats?.total_points ?? 0,
      minutes: element.stats?.minutes ?? 0,
      played: Boolean(element.stats?.played ?? (element.stats?.minutes ?? 0) > 0),
      bps: element.stats?.bps ?? 0,
      bonus: element.stats?.bonus ?? 0,
      fixtures: (element.explain ?? []).map((entry) => entry.fixture),
    }));
  }

  async loadPicks(entryId: number, event: number): Promise<EntryPicks | null> {
    try {
      const data = await this.fetchJson<RawPicks>(
        `${BASE}/entry/${entryId}/event/${event}/picks/`,
        PICKS_TTL,
      );
      return {
        entryId,
        event,
        activeChip: data.active_chip ?? null,
        automaticSubs: (data.automatic_subs ?? []).map((sub) => ({
          out: sub.element_out,
          in: sub.element_in,
        })),
        points: data.entry_history?.points ?? 0,
        transferCost: data.entry_history?.event_transfers_cost ?? 0,
        bank: (data.entry_history?.bank ?? 0) / 10,
        squadValue: (data.entry_history?.value ?? 0) / 10,
        picks: (data.picks ?? []).map((pick) => ({
          playerId: pick.element,
          position: pick.position,
          multiplier: pick.multiplier,
          isCaptain: pick.is_captain,
          isViceCaptain: pick.is_vice_captain,
        })),
      };
    } catch {
      // A manager who has not entered this Gameweek must not fail the league.
      return null;
    }
  }

  /** Picks for several managers at bounded concurrency. */
  async loadPicksFor(entryIds: number[], event: number): Promise<EntryPicks[]> {
    const results: EntryPicks[] = [];
    let cursor = 0;
    const runners = Array.from({ length: Math.min(this.concurrency, entryIds.length) }, async () => {
      while (cursor < entryIds.length) {
        const index = cursor;
        cursor += 1;
        const picks = await this.loadPicks(entryIds[index], event);
        if (picks) results.push(picks);
      }
    });
    await Promise.all(runners);
    return results;
  }

  async loadFixtures(event: number): Promise<LiveFixture[]> {
    const data = await this.fetchJson<RawFixture[]>(
      `${BASE}/fixtures/?event=${event}`,
      FIXTURES_TTL,
    );
    return (data ?? []).map((fixture) => ({
      id: fixture.id,
      homeTeam: fixture.team_h,
      awayTeam: fixture.team_a,
      started: Boolean(fixture.started),
      finished: Boolean(fixture.finished),
      finishedProvisional: Boolean(fixture.finished_provisional ?? fixture.finished),
      kickoff: fixture.kickoff_time ?? null,
    }));
  }
}
