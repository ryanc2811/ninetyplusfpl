import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

/**
 * Renders a route through the built Worker. The interface is split across real
 * routes, so each screen is asserted where it actually lives rather than by
 * grepping one page component for strings.
 */
async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function renderText(path) {
  const response = await render(path);
  assert.equal(response.status, 200, `${path} should server-render`);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  return response.text();
}

test("server-renders the app shell on every screen", async () => {
  const html = await renderText("/");

  assert.match(html, /<title>NINETY\+ (?:—|-) FPL AI Decision Engine<\/title>/i);
  // The rail wordmark, the five destinations and the always-visible deadline.
  assert.match(html, /NINETY/);
  for (const label of ["Home", "Squad", "Players", "Chips", "Leagues"]) {
    assert.match(html, new RegExp(`>${label}<`), `the shell should link to ${label}`);
  }
  assert.match(html, /GW \d+ · DEADLINE|GW \d+ · LIVE|DEADLINE PENDING/);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview|react-loading-skeleton/i);
});

test("each route server-renders its own screen", async () => {
  const screens = [
    ["/", /MODEL SIGNAL/],
    ["/squad", /Your editable squad/],
    ["/players", /players modelled/],
    ["/chips", /Chip strategy and squad route/],
    ["/leagues", /Link your real FPL mini-leagues/],
  ];

  for (const [path, expected] of screens) {
    const html = await renderText(path);
    assert.match(html, expected, `${path} should render its own content`);
  }
});

test("keeps the squad, projection and chip behaviour after the route split", async () => {
  const [state, squad, players, chips, route, model, packageJson] = await Promise.all([
    readFile(new URL("../app/_state/app-state.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_views/squad-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_views/players-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_views/chips-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/fpl/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/fpl-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  // Squad editing rules live in the shared state, and the screens still use them.
  assert.match(state, /chooseReplacement/);
  assert.match(state, /promoteBenchPlayer/);
  assert.match(state, /swapLineupPlayer/);
  assert.match(state, /squadStrategyForGameweek/);
  assert.match(squad, /Your editable squad/);
  assert.match(squad, /Live validation/);

  // The model's evidence is still shown, labelled with which model produced it.
  assert.match(players, /WHY THIS FORECAST/);
  assert.match(players, /Experimental trained xMins/);
  assert.match(players, /Expected-minutes baseline/);
  assert.match(chips, /Apply plan and rebuild GW1 squad/);

  assert.match(route, /dataQuality/);
  assert.match(route, /provenance/);
  assert.match(model, /projectExpectedMinutes/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.deepEqual(await readdir(new URL("../app/_sites-preview", import.meta.url)), []);
});

test("ships the design tokens and the mobile-first floors", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  // Generated from docs/design/redesign/tokens.json.
  assert.match(css, /NINETY\+ design tokens/);
  assert.match(css, /--text-muted: #4f5f56;/);
  assert.match(css, /--accent: #b7f34a;/);
  // Both themes ship, and the OS preference is followed unless light is chosen.
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  // Nothing below 12px, 44px tap targets, and the tab bar clears the safe area.
  assert.match(css, /--tap-min: 44px;/);
  assert.match(css, /\.t-caption \{ font-family: var\(--sans\); font-size: 12px;/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});
