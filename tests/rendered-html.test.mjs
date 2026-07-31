import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the NINETY+ product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>NINETY\+ (?:—|-) FPL AI Decision Engine<\/title>/i);
  assert.match(html, /Decision room/);
  assert.match(html, /Squad builder/);
  assert.match(html, /Player lab/);
  assert.match(html, /Run optimiser/);
  assert.doesNotMatch(html, /Your site is taking shape|codex-preview|react-loading-skeleton/i);
});

test("keeps prediction provenance and removes disposable starter code", async () => {
  const [page, route, model, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/fpl/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/fpl-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Experimental trained xMins/);
  assert.match(page, /Expected-minutes baseline/);
  assert.match(page, /WHY THIS FORECAST/);
  assert.match(page, /Your editable squad/);
  assert.match(page, /chooseReplacement/);
  assert.match(page, /promoteBenchPlayer/);
  assert.match(page, /swapLineupPlayer/);
  assert.match(page, /Apply plan and rebuild GW1 squad/);
  assert.match(page, /squadStrategyForGameweek/);
  assert.match(page, /Live validation/);
  assert.match(route, /dataQuality/);
  assert.match(route, /provenance/);
  assert.match(model, /projectExpectedMinutes/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.deepEqual(await readdir(new URL("../app/_sites-preview", import.meta.url)), []);
});
