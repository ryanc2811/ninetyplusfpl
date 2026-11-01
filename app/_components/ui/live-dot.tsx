import { cn } from "../cn";

/** The lime pulse that marks live data. Lime is a fill, never text. */
export function LiveDot({ className, pulse = true }: { className?: string; pulse?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "h-2 w-2 flex-none rounded-full bg-accent",
        pulse && "np-pulse",
        className,
      )}
    />
  );
}
