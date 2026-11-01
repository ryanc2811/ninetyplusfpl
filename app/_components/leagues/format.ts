import type { MonthWindow } from "../../../lib/contracts/leagues";

/** 1st, 2nd, 3rd … for the places a manager reads out loud. */
export function ordinal(value: number) {
  const suffixes = ["th", "st", "nd", "rd"];
  const remainder = value % 100;
  return `${value}${suffixes[(remainder - 20) % 10] || suffixes[remainder] || suffixes[0]}`;
}

/** Deltas are always signed, and a minus is a real minus sign. */
export function signed(value: number) {
  return value >= 0 ? `+${value}` : `−${Math.abs(value)}`;
}

/** First names keep a crowded row readable; "You" stays "you" mid-sentence. */
export function firstName(managerName: string, isYou = false) {
  if (isYou) return "you";
  return managerName.trim().split(/\s+/)[0] || managerName;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** "GW 7–10", or "GW 7" for a one-Gameweek month. */
export function gameweekRangeLabel(month: Pick<MonthWindow, "startEvent" | "stopEvent">) {
  return month.startEvent === month.stopEvent
    ? `GW ${month.startEvent}`
    : `GW ${month.startEvent}–${month.stopEvent}`;
}

/** Three letters is all a month tab has room for. */
export function shortMonth(name: string) {
  return name.slice(0, 3);
}

/**
 * How far through a month the standings actually are.
 *
 * A Gameweek appears in a manager's history as soon as it is scored, but the
 * official feed only marks it data-checked once bonus is confirmed, so the
 * latest counted Gameweek can still be provisional. Saying which is which is
 * the difference between a live figure and a wrong one.
 */
export function monthProgress(result: {
  month: Pick<MonthWindow, "startEvent" | "stopEvent" | "gameweeksPlayed" | "complete">;
  standings: Array<{ gameweeks: Array<{ event: number }> }>;
}) {
  const events = result.standings.flatMap((row) => row.gameweeks.map((week) => week.event));
  const counted = events.length ? new Set(events).size : 0;
  const latestEvent = events.length ? Math.max(...events) : null;
  return {
    counted,
    total: result.month.stopEvent - result.month.startEvent + 1,
    latestEvent,
    provisional: !result.month.complete && counted > result.month.gameweeksPlayed,
  };
}
