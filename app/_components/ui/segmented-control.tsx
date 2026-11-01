"use client";

import type { ReactNode } from "react";
import { cn } from "../cn";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  /** A live month carries a dot beside its label. */
  live?: boolean;
  adornment?: ReactNode;
};

/**
 * The month and view switcher. A recessed track with one raised option, built
 * as a tablist so a screen reader announces the selection rather than a row of
 * unrelated buttons.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("grid gap-1 rounded-sm bg-surface-2 p-1", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "np-press t-label flex min-h-10 items-center justify-center gap-1.5 rounded-[8px]",
              selected
                ? "bg-surface text-text shadow-[var(--shadow-sm)]"
                : "bg-transparent text-text-muted",
            )}
          >
            {option.label}
            {option.live && (
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-positive" />
            )}
            {option.adornment}
          </button>
        );
      })}
    </div>
  );
}
