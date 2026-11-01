"use client";

import type { ReactNode } from "react";
import { cn } from "../cn";

/**
 * One row, one key figure. Probabilities, breakdowns and evidence open in a
 * sheet rather than expanding the row, and the whole row is the tap target so
 * nothing relies on a control smaller than 44px.
 */
export function PlayerRow({
  lead,
  title,
  meta,
  figure,
  figureNote,
  trailing,
  selected = false,
  flash = false,
  onClick,
  ariaLabel,
  className,
}: {
  /** Rank, avatar or shirt disc. */
  lead?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  /** The single key number for the row. */
  figure?: ReactNode;
  figureNote?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  /** Set for one render cycle when a live score changes. */
  flash?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
}) {
  const body = (
    <>
      {lead && <span className="flex w-6 flex-none flex-col items-center gap-0.5">{lead}</span>}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="t-headline flex items-center gap-1.5 truncate">{title}</span>
        {meta && <span className="t-body-sm truncate text-text-muted">{meta}</span>}
        {trailing}
      </span>
      {(figure !== undefined || figureNote !== undefined) && (
        <span className="flex flex-none flex-col items-end gap-0.5">
          {figure !== undefined && <span className="t-data-lg">{figure}</span>}
          {figureNote !== undefined && <span className="t-caption font-mono">{figureNote}</span>}
        </span>
      )}
    </>
  );

  const classes = cn(
    "flex w-full items-center gap-2.5 border-t border-border px-3 py-2.5 text-left",
    "min-h-[var(--row-min)]",
    selected ? "bg-positive-soft shadow-[inset_4px_0_0_var(--accent)]" : "bg-surface",
    flash && "np-flash",
    className,
  );

  if (!onClick) {
    return <div className={classes}>{body}</div>;
  }
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} className={cn(classes, "np-press")}>
      {body}
    </button>
  );
}

/** The rank movement marker: a filled triangle, never colour alone. */
export function RankMove({ direction }: { direction: "up" | "down" }) {
  return direction === "up" ? (
    <svg width="10" height="8" viewBox="0 0 10 8" role="img" aria-label="Moved up">
      <path d="M5 0 10 8H0z" fill="var(--positive)" />
    </svg>
  ) : (
    <svg width="10" height="8" viewBox="0 0 10 8" role="img" aria-label="Moved down">
      <path d="M5 8 0 0h10z" fill="var(--negative)" />
    </svg>
  );
}
