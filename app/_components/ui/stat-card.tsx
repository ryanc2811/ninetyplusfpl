import type { ReactNode } from "react";
import { cn } from "../cn";

/**
 * One figure, named and sourced. The value is the editorial serif at `stat`
 * size; the hero variant sits on `ink`, which stays dark in both themes.
 */
export function StatCard({
  label,
  value,
  unit,
  footer,
  hero = false,
  tone = "default",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  footer?: ReactNode;
  hero?: boolean;
  tone?: "default" | "positive" | "negative" | "warning";
  className?: string;
}) {
  const valueTone = {
    default: hero ? "text-on-ink" : "text-text",
    positive: hero ? "text-accent" : "text-positive",
    negative: "text-negative",
    warning: "text-warning",
  }[tone];

  return (
    <article
      className={cn(
        "flex flex-col gap-1 rounded-md p-4 medium:p-5",
        hero
          ? "rounded-lg bg-ink text-on-ink"
          : "border border-border bg-surface shadow-[var(--shadow-sm)]",
        className,
      )}
    >
      <span className={cn("t-eyebrow", hero ? "text-on-ink-muted" : "text-text-muted")}>
        {label}
      </span>
      <span className={cn("t-stat", valueTone)}>
        {value}
        {unit && <span className="t-body-sm ml-1 align-baseline">{unit}</span>}
      </span>
      {footer && (
        <span className={cn("t-caption", hero ? "text-on-ink-muted" : "text-text-muted")}>
          {footer}
        </span>
      )}
    </article>
  );
}
