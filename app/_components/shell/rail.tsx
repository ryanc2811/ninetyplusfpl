"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppState } from "../../_state/app-state";
import { cn } from "../cn";
import { Icon } from "../ui/icon";
import { Wordmark } from "../ui/wordmark";
import { NAV_ITEMS, currentNavItem } from "./nav";

/** At 900px and up the tab bar becomes this ink side rail. */
export function Rail() {
  const pathname = usePathname();
  const current = currentNavItem(pathname);
  const { nextEvent, nextDeadline } = useAppState();

  const deadline = nextDeadline ? new Date(nextDeadline) : null;
  const deadlineText = deadline && !Number.isNaN(deadline.getTime())
    ? `GW ${nextEvent} · ${deadline.toLocaleString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : "Awaiting the official feed";

  return (
    <aside className="sticky top-0 hidden h-screen flex-col gap-6 bg-ink px-4 py-6 text-on-ink expanded:flex">
      <Wordmark className="px-2 text-[22px] leading-6" />
      <nav aria-label="Main" className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = item.href === current.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "t-label flex min-h-[var(--tap-min)] items-center gap-3 rounded-sm px-3 no-underline",
                active ? "bg-accent font-semibold text-on-accent" : "text-on-ink-muted",
              )}
            >
              <Icon name={item.icon} size={22} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-1 border-t border-white/10 pt-4">
        <span className="t-eyebrow text-on-ink-muted">Next deadline</span>
        <span className="t-body-sm">{deadlineText}</span>
      </div>
    </aside>
  );
}
