"use client";

import type { ReactNode } from "react";
import { AppStateProvider } from "../../_state/app-state";
import { Rail } from "./rail";
import { TabBar } from "./tab-bar";
import { TopBar } from "./top-bar";

/**
 * One shell for every screen: the ink rail at 900px and up, the bottom tab bar
 * below it, and a top bar that always shows the Gameweek and deadline.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AppStateProvider>
      <div className="min-h-screen expanded:grid expanded:grid-cols-[var(--rail)_minmax(0,1fr)]">
        <Rail />
        <div className="flex min-w-0 flex-col">
          <TopBar />
          <main className="np-page-bottom mx-auto w-full max-w-[var(--content-max)] flex-1 px-4 pt-3 expanded:px-6 expanded:pt-5">
            {children}
          </main>
        </div>
        <TabBar />
      </div>
    </AppStateProvider>
  );
}
