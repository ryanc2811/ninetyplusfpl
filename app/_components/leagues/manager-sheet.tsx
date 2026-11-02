"use client";

import type { MonthlyResult, MonthlyStanding } from "../../../lib/contracts/leagues";
import type { LiveManager } from "../../../lib/contracts/live";
import { BottomSheet, Button, Chip } from "../ui";
import { gameweekRangeLabel, initials, ordinal } from "./format";

function Tile({
  label,
  value,
  emphasis = "stat",
}: {
  label: string;
  value: string;
  /** The month's headline figures are editorial; the supporting ones are data. */
  emphasis?: "stat" | "data";
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-sm bg-surface-2 p-3">
      <span className="t-caption text-text-muted">{label}</span>
      <span className={emphasis === "stat" ? "t-stat" : "t-data-lg"}>{value}</span>
    </div>
  );
}

/**
 * A manager's month, on demand. The list rows carry one figure each; this is
 * where the rest of it lives.
 */
export function ManagerSheet({
  result,
  row,
  youEntryId,
  leagueId,
  live,
  onClose,
}: {
  result: MonthlyResult;
  row: MonthlyStanding | null;
  youEntryId: number | null;
  leagueId: number | null;
  live?: LiveManager | null;
  onClose: () => void;
}) {
  if (!row) return null;
  const you = row.entryId === youEntryId;
  const name = you ? "You" : row.managerName || row.teamName;
  const comparable = !you && youEntryId !== null && leagueId !== null;

  return (
    <BottomSheet
      open
      onClose={onClose}
      label={`${name} in ${result.month.name}`}
      header={
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-surface-3 text-[15px] font-semibold">
            {initials(row.managerName || row.teamName)}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="t-eyebrow text-text-muted">
              {ordinal(row.rank)} in {result.month.name} · {gameweekRangeLabel(result.month)}
            </span>
            <span className="t-title-2 truncate">{name}</span>
            <span className="t-body-sm truncate text-text-muted">{row.teamName}</span>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <Tile label={`${result.month.name} net`} value={String(row.netPoints)} />
        <Tile label="Gross points" value={String(row.grossPoints)} />
        <Tile
          label="Hits this month"
          emphasis="data"
          value={row.transferCost > 0 ? `−${row.transferCost} pts` : "None"}
        />
        <Tile
          label="Left on the bench"
          emphasis="data"
          value={`${row.pointsOnBench} pts`}
        />
      </div>

      {live && (live.substitutions.length > 0 || live.captainMoved) && (
        <div className="flex flex-col gap-1">
          <span className="t-eyebrow text-text-muted">The bench stepped in</span>
          {live.substitutions.map((sub) => (
            <div
              key={`${sub.out}-${sub.in}`}
              className="flex min-h-[var(--tap-min)] items-center justify-between gap-3 border-b border-border"
            >
              <span className="t-body">
                <b>{sub.in}</b> came on for {sub.out}
              </span>
              <Chip tone={sub.official ? "neutral" : "warning"}>
                {sub.official ? "Confirmed" : "Projected"}
              </Chip>
            </div>
          ))}
          {live.captainMoved && (
            <p className="t-body m-0 text-text-muted">
              The captain did not play, so the armband passed to the vice-captain.
            </p>
          )}
        </div>
      )}

      {live && (
        <div className="flex flex-col gap-1">
          <span className="t-eyebrow text-text-muted">Still to play</span>
          {live.toPlay.map((player) => (
            <div
              key={player.playerId}
              className="flex min-h-[var(--tap-min)] items-center justify-between gap-3 border-b border-border"
            >
              <span className="t-body flex items-center gap-1.5 font-semibold">
                {player.name}
                {player.multiplier > 1 && (
                  <Chip tone="accent">{player.multiplier === 3 ? "TC" : "C"}</Chip>
                )}
              </span>
              <span className="t-data text-text-muted">
                {player.fixture}
                {player.kickoff
                  && ` · ${new Date(player.kickoff).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`}
              </span>
            </div>
          ))}
          {!live.toPlay.length && (
            <p className="t-body m-0 text-text-muted">
              Everyone has played. This score is final unless bonus changes.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="t-eyebrow text-text-muted">Gameweek by gameweek</span>
        {row.gameweeks.map((week) => (
          <div
            key={week.event}
            className="flex min-h-[var(--tap-min)] items-center justify-between gap-3 border-b border-border"
          >
            <span className="t-body font-semibold">GW {week.event}</span>
            <span className="t-data text-text-muted">
              {week.points} pts
              {week.netPoints !== week.points && ` · ${week.netPoints} net`}
            </span>
          </div>
        ))}
        {!row.gameweeks.length && (
          <p className="t-body m-0 text-text-muted">
            Nothing scored in {result.month.name} yet.
          </p>
        )}
      </div>

      {comparable && (
        <Button variant="primary" block href={`/leagues/${leagueId}/h2h/${row.entryId}`}>
          Compare squads
        </Button>
      )}
    </BottomSheet>
  );
}
