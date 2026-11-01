import type { IconName } from "../ui/icon";

/** Screen titles are short nouns, and the same list drives the rail and the tab bar. */
export const NAV_ITEMS: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/squad", label: "Squad", icon: "squad" },
  { href: "/players", label: "Players", icon: "players" },
  { href: "/chips", label: "Chips", icon: "chips" },
  { href: "/leagues", label: "Leagues", icon: "trophy" },
];

/** The deepest matching item, so /leagues/123 still marks Leagues as current. */
export function currentNavItem(pathname: string) {
  const matches = NAV_ITEMS.filter(
    (item) => pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`)),
  );
  return matches.sort((a, b) => b.href.length - a.href.length)[0] ?? NAV_ITEMS[0];
}
