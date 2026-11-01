"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LeagueLiveResponse, LiveManager } from "../../lib/contracts/live";

/** While players are on the pitch. */
const LIVE_INTERVAL = 60_000;
/** Everything has been played; only bonus can still move the table. */
const BONUS_INTERVAL = 300_000;

function intervalFor(data: LeagueLiveResponse | null) {
  if (!data || !data.started) return null;
  if (data.finished && data.dataChecked) return null;
  const playing = data.managers.some((manager) => manager.playersToPlay > 0);
  return playing ? LIVE_INTERVAL : BONUS_INTERVAL;
}

export type LiveLeague = {
  data: LeagueLiveResponse | null;
  byEntry: Map<number, LiveManager>;
  /** Points gained since the previous poll, for the "+N" pill. */
  deltas: Map<number, number>;
  secondsAgo: number | null;
  refresh: () => void;
};

/**
 * Follows a league's live Gameweek.
 *
 * Polling backs off on its own: a minute while players are still on the
 * pitch, five minutes once everything has been played and only bonus can
 * move, and not at all when no Gameweek is live or the tab is hidden. The
 * route behind it costs one upstream request per poll for every manager's
 * points, because picks are cached for far longer than the interval.
 */
type Snapshot = {
  /** Tagged with its league, so a switch never shows the previous one. */
  leagueId: number;
  response: LeagueLiveResponse;
  fetchedAt: number;
  deltas: Map<number, number>;
};

export function useLiveLeague(leagueId: number | null): LiveLeague {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [refreshKey, setRefreshKey] = useState(0);
  const previousPoints = useRef<Map<number, number>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deltaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    if (!leagueId) return;

    let cancelled = false;
    previousPoints.current = new Map();

    const schedule = (next: LeagueLiveResponse | null) => {
      const wait = intervalFor(next);
      if (wait === null || cancelled) return;
      timer.current = setTimeout(poll, wait);
    };

    const poll = async () => {
      // A hidden tab is nobody watching; check back rather than fetching.
      if (typeof document !== "undefined" && document.hidden) {
        timer.current = setTimeout(poll, LIVE_INTERVAL);
        return;
      }
      try {
        const response = await fetch(`/api/leagues/${leagueId}/live`);
        if (!response.ok) throw new Error(String(response.status));
        const next = (await response.json()) as LeagueLiveResponse;
        if (cancelled) return;

        const changed = new Map<number, number>();
        for (const manager of next.managers) {
          const before = previousPoints.current.get(manager.entryId);
          if (before !== undefined && manager.points !== before) {
            changed.set(manager.entryId, manager.points - before);
          }
          previousPoints.current.set(manager.entryId, manager.points);
        }

        setSnapshot({ leagueId, response: next, fetchedAt: Date.now(), deltas: changed });
        setNow(Date.now());
        if (changed.size) {
          if (deltaTimer.current) clearTimeout(deltaTimer.current);
          // Long enough to read the pill, short enough not to go stale.
          deltaTimer.current = setTimeout(
            () => setSnapshot((current) => (current ? { ...current, deltas: new Map() } : current)),
            6000,
          );
        }
        schedule(next);
      } catch {
        if (!cancelled) timer.current = setTimeout(poll, BONUS_INTERVAL);
      }
    };

    void poll();

    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      if (deltaTimer.current) clearTimeout(deltaTimer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [leagueId, refreshKey]);

  // The "updated Xs ago" label only needs to be roughly right.
  useEffect(() => {
    if (!snapshot) return;
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(tick);
  }, [snapshot]);

  const current = snapshot && snapshot.leagueId === leagueId ? snapshot : null;

  return {
    data: current?.response ?? null,
    byEntry: new Map(
      (current?.response.managers ?? []).map((manager) => [manager.entryId, manager]),
    ),
    deltas: current?.deltas ?? new Map(),
    secondsAgo: current ? Math.max(0, Math.round((now - current.fetchedAt) / 1000)) : null,
    refresh,
  };
}

/** "Updated 12s ago", "Updated 3m ago". */
export function updatedAgoLabel(secondsAgo: number | null) {
  if (secondsAgo === null) return "Waiting for the live feed";
  if (secondsAgo < 60) return `Updated ${secondsAgo}s ago`;
  return `Updated ${Math.round(secondsAgo / 60)}m ago`;
}
