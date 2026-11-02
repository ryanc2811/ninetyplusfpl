"use client";

import type { MonthlyResult, MonthlyStanding } from "../../../lib/contracts/leagues";
import { Icon, LiveDot } from "../ui";
import { WinChanceBar } from "./win-bar";
import { formatChance, winChanceSegments } from "./win-chance";
import { firstName, gameweekRangeLabel, monthProgress, ordinal } from "./format";

function headline(
  result: MonthlyResult,
  rows: MonthlyStanding[],
  you: MonthlyStanding | undefined,
) {
  const leader = rows[0];
  const second = rows[1];
  if (!leader) return `No scores in ${result.month.name} yet`;

  if (result.month.complete) {
    if (you && you.rank === 1) return `You won ${result.month.name}`;
    return `${firstName(leader.managerName)} won ${result.month.name}`;
  }
  if (you) {
    if (you.rank === 1) {
      const clear = second ? you.netPoints - second.netPoints : 0;
      return second
        ? `You're top, ${clear} ${clear === 1 ? "pt" : "pts"} clear of ${firstName(second.managerName)}`
        : "You're top of the month";
    }
    const behind = leader.netPoints - you.netPoints;
    return `You're ${ordinal(you.rank)}, ${behind} ${behind === 1 ? "pt" : "pts"} behind ${firstName(leader.managerName)}`;
  }
  const margin = second ? leader.netPoints - second.netPoints : 0;
  return second
    ? `${firstName(leader.managerName)} leads by ${margin}`
    : `${firstName(leader.managerName)} leads ${result.month.name}`;
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="t-caption text-on-ink-muted">{label}</span>
      <span className="t-data-lg">{value}</span>
    </div>
  );
}

/**
 * The month in one card: where you stand, and the figures behind it. It is the
 * one `display`-weight statement on the screen.
 */
export function MonthHero({
  result,
  youEntryId,
  winChance,
}: {
  result: MonthlyResult;
  youEntryId: number | null;
  /** The model's simulated chance of winning the month, by team. */
  winChance?: Map<number, number> | null;
}) {
  const rows = result.standings;
  const leader = rows[0];
  const you = rows.find((row) => row.entryId === youEntryId);
  const subject = you ?? leader;
  const latest = subject?.gameweeks[subject.gameweeks.length - 1];
  const complete = result.month.complete;
  const progress = monthProgress(result);

  return (
    <section
      aria-label={`${result.month.name} summary`}
      className="flex flex-col gap-3 rounded-lg bg-ink p-4 text-on-ink medium:p-5"
    >
      <div className="t-eyebrow flex items-center justify-between gap-2 text-on-ink-muted">
        <span>
          {result.month.name} · {gameweekRangeLabel(result.month)}
        </span>
        {complete ? (
          <span>Final</span>
        ) : (
          <span className="flex items-center gap-1.5 text-accent">
            <LiveDot />
            {progress.provisional
              ? `GW ${progress.latestEvent} provisional`
              : `${progress.counted} of ${progress.total} played`}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {complete && (
          <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-accent text-on-accent">
            <Icon name="trophy" size={22} />
          </span>
        )}
        <p className="t-title-1 m-0 font-serif">{headline(result, rows, you)}</p>
      </div>

      {subject && (
        <div className="grid grid-cols-3 gap-2">
          <Figure
            label={you ? "Your month" : `${firstName(subject.managerName)}'s month`}
            value={`${subject.netPoints} net`}
          />
          <Figure
            label={latest ? `GW ${latest.event}` : "Latest GW"}
            value={latest ? `${latest.points} pts` : "—"}
          />
          {winChance && subject ? (
            <Figure
              label={you ? "Your chance" : "Their chance"}
              value={formatChance(winChance.get(subject.entryId) ?? 0)}
            />
          ) : (
            <Figure
              label="Hits this month"
              value={subject.transferCost > 0 ? `−${subject.transferCost} pts` : "None"}
            />
          )}
        </div>
      )}

      {winChance && (
        <div className="flex flex-col gap-1.5">
          <WinChanceBar segments={winChanceSegments(winChance, result, youEntryId)} />
          <span className="t-caption text-on-ink-muted">
            Chance to win {result.month.name} — the model&apos;s estimate, from simulating the
            fixtures left.
          </span>
        </div>
      )}
    </section>
  );
}
