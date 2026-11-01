import { cn } from "../cn";

/** Difficulty drives the fill; the number and the opponent are always printed. */
const FILLS: Record<number, string> = {
  1: "bg-fdr-1 text-on-fdr-1",
  2: "bg-fdr-2 text-on-fdr-2",
  3: "bg-fdr-3 text-on-fdr-3",
  4: "bg-fdr-4 text-on-fdr-4",
  5: "bg-fdr-5 text-on-fdr-5",
};

export function FdrChip({
  opponent,
  venue,
  difficulty,
  className,
}: {
  opponent: string;
  venue: "H" | "A";
  difficulty: number;
  className?: string;
}) {
  const level = Math.min(5, Math.max(1, Math.round(difficulty)));
  return (
    <span
      className={cn(
        "t-caption inline-flex items-center gap-1 rounded-xs px-1.5 py-1 font-mono",
        FILLS[level],
        className,
      )}
      title={`${opponent} (${venue === "H" ? "home" : "away"}) · difficulty ${level}`}
    >
      <span className="font-semibold">{opponent}</span>
      <span>{venue}</span>
      <span aria-hidden="true">·</span>
      <span>{level}</span>
    </span>
  );
}
