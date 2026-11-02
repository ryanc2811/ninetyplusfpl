"use client";

import type { MonthlyResult, MonthlyStanding } from "../../../lib/contracts/leagues";
import type { LiveManager } from "../../../lib/contracts/live";
import { cn } from "../cn";
import { Chip, PlayerRow, RankMove } from "../ui";
import { monthProgress, signed } from "./format";
import { WinChanceMeter } from "./win-bar";
import { formatChance } from "./win-chance";

/** What the live feed knows about this league right now. */
export type LiveView = {
  byEntry: Map<number, LiveManager>;
  /** Points gained since the last poll, shown as a pill for a few seconds. */
  deltas: Map<number, number>;
  /** The model's simulated chance of winning the month, by team. */
  winChance?: Map<number, number>;
};

/** "GW 9 · 57 pts · 3 to play", with the live part only while it is live. */
function metaFor(row: MonthlyStanding, live: LiveView | undefined) {
  const latest = row.gameweeks[row.gameweeks.length - 1];
  if (!latest) return "No scores yet";
  const manager = live?.byEntry.get(row.entryId);
  const parts = [`GW ${latest.event}`, `${latest.points} pts`];
  if (manager && manager.playersToPlay > 0) {
    parts.push(`${manager.playersToPlay} to play`);
  } else if (manager) {
    parts.push("all played");
  }
  if (row.transferCost > 0) parts.push(`−${row.transferCost} hits`);
  return parts.join(" · ");
}

function DeltaPill({ delta }: { delta: number | undefined }) {
  if (!delta) return null;
  return (
    <Chip tone="accent" mono aria-label={`${signed(delta)} points just now`}>
      {signed(delta)}
    </Chip>
  );
}

/** How far off the lead a row is, or how clear it is at the top. */
export function gapLabel(row: MonthlyStanding, rows: MonthlyStanding[]) {
  const leader = rows[0];
  if (!leader) return "—";
  if (row.rank === 1) {
    const chaser = rows.find((other) => other.rank > 1);
    return chaser ? `${signed(row.netPoints - chaser.netPoints)} clear` : "—";
  }
  return signed(row.netPoints - leader.netPoints);
}

function movement(row: MonthlyStanding) {
  if (row.previousRank === null || row.previousRank === row.rank) return null;
  return <RankMove direction={row.rank < row.previousRank ? "up" : "down"} />;
}

function nameOf(row: MonthlyStanding, youEntryId: number | null) {
  return row.entryId === youEntryId ? "You" : row.managerName || row.teamName;
}

function latestOf(row: MonthlyStanding) {
  return row.gameweeks[row.gameweeks.length - 1] ?? null;
}

/** Below 900px the standings are a list: one row, one key figure. */
export function StandingsList({
  result,
  youEntryId,
  live,
  onSelect,
}: {
  result: MonthlyResult;
  youEntryId: number | null;
  live?: LiveView;
  onSelect: (entryId: number) => void;
}) {
  const rows = result.standings;
  return (
    <section
      aria-label={`${result.month.name} standings`}
      className="overflow-hidden rounded-md border border-border bg-surface shadow-[var(--shadow-sm)] expanded:hidden"
    >
      <div className="t-eyebrow flex justify-between bg-surface-2 px-3 py-2 text-text-muted">
        <span>Manager</span>
        <span>{result.month.name} net · gap</span>
      </div>
      {rows.map((row) => {
        const you = row.entryId === youEntryId;
        const delta = live?.deltas.get(row.entryId);
        return (
          <PlayerRow
            key={row.entryId}
            selected={you}
            flash={Boolean(delta)}
            onClick={() => onSelect(row.entryId)}
            ariaLabel={`${nameOf(row, youEntryId)}, ${row.netPoints} net points, rank ${row.rank}`}
            lead={
              <>
                <span className="t-data font-semibold">{row.rank}</span>
                {movement(row)}
              </>
            }
            title={
              <>
                {nameOf(row, youEntryId)}
                <DeltaPill delta={delta} />
              </>
            }
            meta={metaFor(row, live)}
            trailing={
              live?.winChance?.has(row.entryId) ? (
                <WinChanceMeter chance={live.winChance.get(row.entryId)!} you={you} />
              ) : undefined
            }
            figure={row.netPoints}
            figureNote={
              <span className={row.rank === 1 ? "text-positive" : "text-text-muted"}>
                {gapLabel(row, rows)}
              </span>
            }
          />
        );
      })}
      <p className="t-caption m-0 border-t border-border px-3 py-2.5 text-text-muted">
        Net of transfer hits.
        {live?.winChance ? " The bar is the model's estimated chance of winning the month." : ""}{" "}
        Tap a manager for their month in detail.
      </p>
    </section>
  );
}

/** At 900px and up the same standings become a table. */
export function StandingsTable({
  result,
  youEntryId,
  live,
  onSelect,
}: {
  result: MonthlyResult;
  youEntryId: number | null;
  live?: LiveView;
  onSelect: (entryId: number) => void;
}) {
  const rows = result.standings;
  const progress = monthProgress(result);

  return (
    <section
      aria-label={`${result.month.name} standings`}
      className="hidden overflow-hidden rounded-md border border-border bg-surface shadow-[var(--shadow-sm)] expanded:block"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="t-title-2 m-0">{result.month.name} standings</h2>
        <span className="t-body-sm text-text-muted">
          Net of hits · {progress.counted} of {progress.total} played
          {progress.provisional && " · bonus not final"}
        </span>
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="t-eyebrow bg-surface-2 text-text-muted">
            <th scope="col" className="px-3 py-2 text-left">#</th>
            <th scope="col" className="px-3 py-2 text-left">Manager</th>
            <th scope="col" className="px-3 py-2 text-right">
              {progress.latestEvent ? `GW ${progress.latestEvent}` : "Latest"}
            </th>
            <th scope="col" className="px-3 py-2 text-right">Net</th>
            <th scope="col" className="px-3 py-2 text-right">Gap</th>
            <th scope="col" className="px-3 py-2 text-right">Hits</th>
            <th scope="col" className="px-3 py-2 text-right">To play</th>
            {live?.winChance && <th scope="col" className="px-3 py-2 text-right">Win</th>}
            <th scope="col" className="px-3 py-2 text-right">Bench</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const latest = latestOf(row);
            const you = row.entryId === youEntryId;
            const delta = live?.deltas.get(row.entryId);
            const manager = live?.byEntry.get(row.entryId);
            return (
              <tr
                key={row.entryId}
                className={cn(
                  "border-t border-border",
                  you && "bg-positive-soft shadow-[inset_4px_0_0_var(--accent)]",
                  delta !== undefined && "np-flash",
                )}
              >
                <td className="px-3 py-2">
                  <span className="t-data flex items-center gap-1.5 font-semibold">
                    {row.rank}
                    {movement(row)}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onSelect(row.entryId)}
                    className="np-press flex min-h-[var(--tap-min)] flex-col items-start justify-center text-left"
                  >
                    <span className="t-headline flex items-center gap-1.5">
                      {nameOf(row, youEntryId)}
                      <DeltaPill delta={delta} />
                    </span>
                    <span className="t-body-sm text-text-muted">{row.teamName}</span>
                  </button>
                </td>
                <td className="t-data px-3 py-2 text-right">{latest ? latest.points : "—"}</td>
                <td className="t-data-lg px-3 py-2 text-right">{row.netPoints}</td>
                <td
                  className={cn(
                    "t-data px-3 py-2 text-right",
                    row.rank === 1 ? "text-positive" : "text-text-muted",
                  )}
                >
                  {gapLabel(row, rows)}
                </td>
                <td
                  className={cn(
                    "t-data px-3 py-2 text-right",
                    row.transferCost > 0 ? "text-negative" : "text-text-muted",
                  )}
                >
                  {row.transferCost > 0 ? `−${row.transferCost}` : "0"}
                </td>
                <td className="t-data px-3 py-2 text-right text-text-muted">
                  {manager ? manager.playersToPlay : "—"}
                </td>
                {live?.winChance && (
                  <td className="t-data px-3 py-2 text-right">
                    <span className="flex items-center justify-end gap-2">
                      <span className="hidden w-14 wide:block">
                        <WinChanceMeter
                          chance={live.winChance.get(row.entryId) ?? 0}
                          you={you}
                        />
                      </span>
                      {formatChance(live.winChance.get(row.entryId) ?? 0)}
                    </span>
                  </td>
                )}
                <td className="t-data px-3 py-2 text-right text-text-muted">{row.pointsOnBench}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** Shared by both layouts: the row a manager's detail sheet is built from. */
export function standingFor(result: MonthlyResult, entryId: number | null) {
  if (entryId === null) return null;
  return result.standings.find((row) => row.entryId === entryId) ?? null;
}

