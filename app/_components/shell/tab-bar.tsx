"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "../cn";
import { Icon } from "../ui/icon";
import { NAV_ITEMS, currentNavItem } from "./nav";

/** Navigation in the thumb zone: the tab bar owns the bottom edge below 900px. */
export function TabBar() {
  const pathname = usePathname();
  const current = currentNavItem(pathname);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-[var(--z-tabbar)] grid grid-cols-5 border-t border-border bg-header-glass pb-[env(safe-area-inset-bottom)] backdrop-blur-md expanded:hidden"
      style={{ minHeight: "var(--tab-bar)" }}
    >
      {NAV_ITEMS.map((item) => {
        const active = item.href === current.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "t-caption flex flex-col items-center justify-center gap-0.5 no-underline",
              "min-h-[var(--tab-bar)]",
              active ? "font-semibold text-text" : "text-text-muted",
            )}
          >
            <span
              className={cn(
                "grid h-[30px] w-14 place-items-center rounded-full",
                active && "bg-accent text-on-accent",
              )}
            >
              <Icon name={item.icon} size={22} />
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
