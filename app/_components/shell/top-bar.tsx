"use client";

import { usePathname } from "next/navigation";
import { useAppState } from "../../_state/app-state";
import { LiveDot } from "../ui/live-dot";
import { currentNavItem } from "./nav";
import { SignOutButton } from "./sign-out";
import { ThemeToggle } from "./theme-toggle";

/**
 * The sticky header. Its eyebrow carries the Gameweek and the deadline at every
 * breakpoint, because an hour before kickoff that is the one thing a manager
 * must never have to hunt for.
 */
export function TopBar({ gated = false }: { gated?: boolean }) {
  const pathname = usePathname();
  const { nextEvent, deadlineLabel, live } = useAppState();
  const title = currentNavItem(pathname).label;

  return (
    <header className="sticky top-0 z-[var(--z-header)] flex flex-none flex-col gap-1.5 border-b border-border bg-header-glass px-4 pb-2 pt-3 backdrop-blur-md expanded:px-6">
      <div className="t-eyebrow flex items-center gap-2 text-text-muted">
        {live && <LiveDot />}
        <span className="truncate">
          GW {nextEvent} · {live ? "LIVE FEED · " : ""}
          {deadlineLabel}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="t-title-1 m-0 truncate">{title}</h1>
        <div className="flex flex-none items-center gap-2">
          <ThemeToggle />
          {gated && <SignOutButton />}
        </div>
      </div>
    </header>
  );
}
