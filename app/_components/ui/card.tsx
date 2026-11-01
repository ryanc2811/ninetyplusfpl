import type { ReactNode } from "react";
import { cn } from "../cn";

/**
 * The default reading ground: a surface with a hairline and a resting shadow.
 * Depth is borders first.
 */
export function Card({
  children,
  className,
  padded = true,
  as: Element = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  as?: "section" | "article" | "div";
  "aria-label"?: string;
  "aria-live"?: "polite";
}) {
  return (
    <Element
      className={cn(
        "rounded-md border border-border bg-surface shadow-[var(--shadow-sm)]",
        padded && "p-4 medium:p-5",
        className,
      )}
      {...rest}
    >
      {children}
    </Element>
  );
}

/** A card's own header: eyebrow plus title on the left, one control on the right. */
export function CardHead({
  eyebrow,
  title,
  aside,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow && <span className="t-eyebrow text-text-muted">{eyebrow}</span>}
        <h2 className="t-title-2 m-0">{title}</h2>
      </div>
      {aside && <div className="flex flex-none items-center gap-2">{aside}</div>}
    </div>
  );
}
