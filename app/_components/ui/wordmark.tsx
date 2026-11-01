import { cn } from "../cn";

/** There is no drawn logo: the wordmark is the mark. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-sans font-extrabold tracking-tight", className)}>
      NINETY<span className="text-accent">+</span>
    </span>
  );
}
