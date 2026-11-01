import type { ReactNode } from "react";
import { cn } from "../cn";

type Tone = "neutral" | "positive" | "negative" | "warning" | "accent" | "ink";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-text-muted",
  positive: "bg-positive-soft text-positive",
  negative: "bg-negative-soft text-negative",
  warning: "bg-warning-soft text-warning",
  accent: "bg-accent text-on-accent",
  ink: "bg-ink text-on-ink",
};

/**
 * A status pill. Every tone is paired with a word, because colour alone never
 * carries the meaning.
 */
export function Chip({
  tone = "neutral",
  mono = false,
  children,
  className,
}: {
  tone?: Tone;
  /** Figures inside a pill use the mono face so they stay tabular. */
  mono?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
        mono ? "t-data" : "t-label",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
