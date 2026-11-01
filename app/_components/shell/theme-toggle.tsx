"use client";

import { useAppState, writeTheme } from "../../_state/app-state";
import { IconButton } from "../ui/button";
import { Icon } from "../ui/icon";

/** Follows the OS until the manager chooses; the choice sets data-theme on <html>. */
export function ThemeToggle() {
  const { theme } = useAppState();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <IconButton label={`Switch to ${next} theme`} onClick={() => writeTheme(next)}>
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </IconButton>
  );
}
