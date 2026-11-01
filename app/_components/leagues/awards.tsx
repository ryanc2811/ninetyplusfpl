"use client";

import { useState } from "react";
import type {
  Badge,
  BadgeKind,
  LeagueInsightsResponse,
  MonthlyResult,
  MonthWindow,
} from "../../../lib/contracts/leagues";
import { cn } from "../cn";
import { Card, CardHead, Chip, Icon, LiveDot, type IconName } from "../ui";
import { firstName, gameweekRangeLabel, shortMonth } from "./format";

const BADGE_ICON: Record<BadgeKind, IconName> = {
  "manager-of-the-month": "trophy",
  "best-gameweek": "star",
  "bench-regret": "bench",
  "hit-taker": "hit",
  "most-consistent": "steady",
};

type MonthRow = {
  key: string;
  name: string;
  range: string;
  who: string;
  detail: string;
  status: "Won" | "Live" | "Next" | "Later";
  you: boolean;
};

function playedRow(result: MonthlyResult, youEntryId: number | null): MonthRow {
  const leader = result.standings[0];
  const chaser = result.standings.find((row) => row.rank > 1);
  const you = result.standings.find((row) => row.entryId === youEntryId);
  const leaderIsYou = Boolean(leader && leader.entryId === youEntryId);
  const margin = leader && chaser ? leader.netPoints - chaser.netPoints : 0;

  return {
    key: `p${result.month.phaseId}`,
    name: result.month.name,
    range: gameweekRangeLabel(result.month),
    who: leader
      ? `${leaderIsYou ? "You" : leader.managerName || leader.teamName}`
        + (result.month.complete ? "" : leaderIsYou ? " lead" : " leads")
      : "No scores yet",
    detail: leader
      ? `${leader.netPoints} net${chaser ? ` · ${margin} clear of ${firstName(chaser.managerName, chaser.entryId === youEntryId)}` : ""}`
      : `${result.month.gameweeksPlayed} gameweeks played`,
    status: result.month.complete ? "Won" : "Live",
    you: leaderIsYou || (!result.month.complete && Boolean(you)),
  };
}

function upcomingRow(month: MonthWindow, index: number): MonthRow {
  return {
    key: `u${month.phaseId}`,
    name: month.name,
    range: gameweekRangeLabel(month),
    who: index === 0 ? `Starts in GW ${month.startEvent}` : `${month.stopEvent - month.startEvent + 1} gameweeks`,
    detail: index === 0 ? "Everyone resets to 0" : "Not started",
    status: index === 0 ? "Next" : "Later",
    you: false,
  };
}

/** Every month of the season, decided or not. */
export function SeasonMonths({
  insights,
  youEntryId,
}: {
  insights: LeagueInsightsResponse;
  youEntryId: number | null;
}) {
  const played = [...insights.months].sort((a, b) => a.month.startEvent - b.month.startEvent);
  const upcoming = [...insights.upcomingMonths].sort((a, b) => a.startEvent - b.startEvent);
  const rows = [
    ...played.map((result) => playedRow(result, youEntryId)),
    ...upcoming.map(upcomingRow),
  ];
  const decided = played.filter((result) => result.month.complete).length;

  return (
    <Card padded={false}>
      <CardHead
        className="p-4 medium:p-5"
        eyebrow="Honours board"
        title="Manager of the Month"
        aside={
          <span className="t-body-sm text-text-muted">
            {decided} of {rows.length} decided
          </span>
        }
      />
      <div className="flex flex-col">
        {rows.map((row) => (
          <div
            key={row.key}
            className={cn(
              "flex min-h-[var(--row-min)] items-center gap-3 border-t border-border px-4 py-2.5",
              row.you && "bg-positive-soft",
            )}
          >
            <span className="flex w-12 flex-none flex-col">
              <span className="t-headline">{shortMonth(row.name)}</span>
              <span className="t-caption font-mono text-text-muted">{row.range}</span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="t-headline truncate">{row.who}</span>
              <span className="t-body-sm truncate text-text-muted">{row.detail}</span>
            </span>
            <Chip
              tone={row.status === "Live" ? "positive" : row.status === "Won" ? "ink" : "neutral"}
            >
              {row.status === "Live" && <LiveDot />}
              {row.status}
            </Chip>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Who has actually won a month, and which ones. */
export function MonthsWon({
  badges,
  youEntryId,
}: {
  badges: Badge[];
  youEntryId: number | null;
}) {
  const monthly = badges.filter((badge) => badge.kind === "manager-of-the-month");
  if (!monthly.length) return null;

  const byEntry = new Map<number, { name: string; months: Badge[] }>();
  for (const badge of monthly) {
    const entry = byEntry.get(badge.entryId) ?? {
      name: badge.entryId === youEntryId ? "You" : badge.managerName || badge.teamName,
      months: [],
    };
    entry.months.push(badge);
    byEntry.set(badge.entryId, entry);
  }
  const winners = [...byEntry.values()].sort((a, b) => b.months.length - a.months.length);

  return (
    <Card>
      <CardHead title="Months won" />
      <div className="mt-3 grid grid-cols-2 gap-3 medium:grid-cols-3">
        {winners.map((winner) => (
          <div key={winner.name} className="flex flex-col gap-0.5 rounded-sm bg-surface-2 p-3">
            <span className="t-eyebrow truncate text-text-muted">{winner.name}</span>
            <span className="t-stat">{winner.months.length}</span>
            <span className="t-caption text-text-muted">
              {winner.months.map((badge) => `${badge.period} · ${badge.value}`).join(", ")}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Season-long character awards. */
export function BadgeGrid({ badges, youEntryId }: { badges: Badge[]; youEntryId: number | null }) {
  if (!badges.length) return null;
  return (
    <Card>
      <CardHead
        title="Badges"
        aside={<span className="t-body-sm text-text-muted">Season so far</span>}
      />
      <div className="mt-3 grid grid-cols-2 gap-3 medium:grid-cols-4">
        {badges.map((badge) => (
          <div
            key={badge.kind}
            className="flex flex-col gap-1 rounded-sm border border-border p-3"
            title={badge.detail}
          >
            <span className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-text">
              <Icon name={BADGE_ICON[badge.kind]} />
            </span>
            <span className="t-label">{badge.label}</span>
            <span className="t-body-sm truncate text-text-muted">
              {badge.entryId === youEntryId ? "You" : badge.managerName || badge.teamName}
            </span>
            <span className="t-data">
              {badge.value}
              {badge.unit === "sd" ? " swing" : " pts"}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

const ALERTS = [
  ["lead", "Lead changes", "When the Manager of the Month leader changes"],
  ["rank", "Your monthly rank", "Each time you move up or down during live games"],
  ["result", "Month result and badges", "When a month is confirmed after bonus"],
  ["deadline", "Deadline reminder", "Two hours before each deadline"],
] as const;

/**
 * Alert preferences.
 *
 * TODO: these are remembered for the session only. Delivering them needs push
 * notifications — a service worker, a subscription per device and a scheduled
 * job that watches the live standings — which is its own piece of work.
 */
export function AlertToggles() {
  const [on, setOn] = useState<Record<string, boolean>>({
    lead: true,
    rank: true,
    result: true,
    deadline: false,
  });

  return (
    <Card>
      <CardHead
        title="Live alerts"
        aside={<Chip tone="warning">Not sending yet</Chip>}
      />
      <div className="mt-2 flex flex-col">
        {ALERTS.map(([id, title, detail]) => (
          <label
            key={id}
            className="flex min-h-[var(--tap-min)] cursor-pointer items-center justify-between gap-3 border-t border-border py-2 first:border-t-0"
          >
            <span className="flex min-w-0 flex-col">
              <span className="t-headline">{title}</span>
              <span className="t-body-sm text-text-muted">{detail}</span>
            </span>
            <input
              type="checkbox"
              checked={on[id]}
              onChange={() => setOn((current) => ({ ...current, [id]: !current[id] }))}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className={cn(
                "flex h-7 w-12 flex-none items-center rounded-full p-0.5 transition-colors",
                on[id] ? "justify-end bg-positive" : "justify-start bg-border-strong",
                "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
              )}
            >
              <span className="h-6 w-6 rounded-full bg-surface" />
            </span>
          </label>
        ))}
      </div>
    </Card>
  );
}
