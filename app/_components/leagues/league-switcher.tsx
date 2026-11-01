"use client";

import { useState } from "react";
import type { LeagueSummary } from "../../../lib/contracts/leagues";
import { cn } from "../cn";
import { BottomSheet, Icon } from "../ui";

/**
 * Picks which league the screen is about. Mini-leagues come first because
 * those are the ones a manager chose to join, and the ones they talk about.
 */
export function LeagueSwitcher({
  leagues,
  selectedId,
  selectedName,
  managerCount,
  onSelect,
}: {
  leagues: LeagueSummary[];
  selectedId: number | null;
  selectedName: string;
  managerCount?: number;
  onSelect: (leagueId: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const groups = [
    { title: "Mini-leagues", items: leagues.filter((league) => league.type === "invitational") },
    { title: "Auto-joined", items: leagues.filter((league) => league.type === "system") },
  ].filter((group) => group.items.length > 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Switch league"
        className="np-press t-label flex min-h-[var(--control-md)] w-full items-center justify-between gap-2 rounded-sm border border-border-strong bg-surface px-3 text-left expanded:w-auto"
      >
        <span className="truncate">
          {selectedName}
          {managerCount ? ` · ${managerCount} managers` : ""}
        </span>
        <Icon name="chevronDown" size={16} />
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        label="Switch league"
        header={<span className="t-title-2">Your leagues</span>}
      >
        {groups.map((group) => (
          <div key={group.title} className="flex flex-col gap-1">
            <span className="t-eyebrow text-text-muted">{group.title}</span>
            {group.items.map((league) => (
              <button
                key={league.id}
                type="button"
                onClick={() => {
                  onSelect(league.id);
                  setOpen(false);
                }}
                className={cn(
                  "np-press flex min-h-[var(--tap-min)] flex-col items-start justify-center gap-0.5 rounded-sm border px-3 py-2 text-left",
                  league.id === selectedId
                    ? "border-transparent bg-positive-soft shadow-[inset_4px_0_0_var(--accent)]"
                    : "border-border bg-surface",
                )}
              >
                <span className="t-headline">{league.name}</span>
                <span className="t-body-sm text-text-muted">
                  {league.rank ? `Rank ${league.rank}` : "Not yet ranked"}
                  {league.entryCount ? ` of ${league.entryCount}` : ""}
                </span>
              </button>
            ))}
          </div>
        ))}
        {!groups.length && (
          <p className="t-body m-0 text-text-muted">
            This team has not joined a classic league yet.
          </p>
        )}
      </BottomSheet>
    </>
  );
}
