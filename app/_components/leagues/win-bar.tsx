"use client";

import { cn } from "../cn";
import { formatChance } from "./win-chance";

type Segment = { entryId: number; chance: number; name: string; you: boolean };

/** Everyone else's slice reads as one grey; yours is the lime one. */
const GREYS = ["bg-on-ink-muted", "bg-border-strong", "bg-surface-3"];

/**
 * The month's race, as the model sees it. It is labelled an estimate wherever
 * it appears, because that is what it is: a simulation of the fixtures left,
 * not a count of anything that has happened.
 */
export function WinChanceBar({
  segments,
  className,
}: {
  segments: Segment[];
  className?: string;
}) {
  if (!segments.length) return null;
  const label = segments
    .map((segment) => `${segment.name} ${formatChance(segment.chance)}`)
    .join(", ");

  let grey = 0;
  const filled = segments.map((segment) => ({
    ...segment,
    fill: segment.you ? "bg-accent" : GREYS[grey++ % GREYS.length],
  }));

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div
        role="img"
        aria-label={`Chance to win the month: ${label}`}
        className="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
      >
        {filled.map((segment) => (
          <span
            key={segment.entryId}
            className={cn("transition-[width] duration-200", segment.fill)}
            style={{ width: `${Math.max(segment.chance * 100, 1)}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {filled.map((segment) => (
          <span key={segment.entryId} className="t-caption flex items-center gap-1 text-on-ink-muted">
            <span aria-hidden="true" className={cn("h-2 w-2 rounded-xs", segment.fill)} />
            {segment.name} {formatChance(segment.chance)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The per-row meter: one manager's share of the simulated wins. */
export function WinChanceMeter({ chance, you }: { chance: number; you: boolean }) {
  return (
    <span
      className="mt-1 block h-1 overflow-hidden rounded-full bg-surface-3"
      title={`${formatChance(chance)} chance to win the month, estimated`}
    >
      <span
        className={cn(
          "block h-1 transition-[width] duration-200",
          you ? "bg-positive" : "bg-border-strong",
        )}
        style={{ width: `${Math.max(chance * 100, 1)}%` }}
      />
    </span>
  );
}
