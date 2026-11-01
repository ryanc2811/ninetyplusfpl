import { cn } from "../cn";

/** A shimmer block shaped like the content it stands in for; never a spinner. */
export function Skeleton({
  width,
  height = 16,
  className,
}: {
  width?: number | string;
  height?: number | string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("np-skel block", className)}
      style={{ width, height }}
    />
  );
}

/** Row-shaped placeholders for a list that is still loading. */
export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="flex min-h-[var(--row-min)] items-center gap-2.5 border-t border-border px-3 py-2.5"
        >
          <Skeleton width={22} height={18} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton width="55%" height={16} />
            <Skeleton width="35%" height={12} />
          </div>
          <Skeleton width={38} height={20} />
        </div>
      ))}
    </div>
  );
}
