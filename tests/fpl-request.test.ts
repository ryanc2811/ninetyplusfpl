import assert from "node:assert/strict";
import test from "node:test";
import {
  FplRequestError,
  describeFplFailure,
  fetchFpl,
} from "../lib/providers/fpl-request.ts";

/** Stands in for the official feed, replying with a queue of statuses. */
function feed(statuses: Array<number | "network">, body: unknown = { ok: true }) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    calls.push(String(url));
    const next = statuses.shift() ?? 200;
    if (next === "network") throw new Error("socket hang up");
    return new Response(JSON.stringify(body), {
      status: next,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("a brief failure is retried rather than passed on", async () => {
  const fake = feed([503, 200]);
  try {
    assert.deepEqual(await fetchFpl("https://example.test/a", 60), { ok: true });
    assert.equal(fake.calls.length, 2);
  } finally {
    fake.restore();
  }
});

test("a dropped connection is retried too", async () => {
  const fake = feed(["network", 200]);
  try {
    await fetchFpl("https://example.test/b", 60);
    assert.equal(fake.calls.length, 2);
  } finally {
    fake.restore();
  }
});

test("a 404 is an answer, not a failure, so it is not retried", async () => {
  const fake = feed([404, 200]);
  try {
    await assert.rejects(
      fetchFpl("https://example.test/c", 60),
      (error: FplRequestError) => error.status === 404,
    );
    assert.equal(fake.calls.length, 1);
  } finally {
    fake.restore();
  }
});

test("retries give up, and the status survives for the route to read", async () => {
  const fake = feed([429, 429, 429]);
  try {
    await assert.rejects(
      fetchFpl("https://example.test/d", 60),
      (error: FplRequestError) => {
        assert.equal(error.status, 429);
        assert.match(error.message, /429/);
        return true;
      },
    );
    assert.equal(fake.calls.length, 3);
  } finally {
    fake.restore();
  }
});

test("each kind of failure gets its own answer", () => {
  assert.equal(describeFplFailure(new FplRequestError(404, "u"), "That league").status, 404);

  const limited = describeFplFailure(new FplRequestError(429, "u"), "That league");
  assert.equal(limited.status, 429);
  assert.match(limited.body.detail, /try again/i);

  const down = describeFplFailure(new FplRequestError(503, "u"), "That league");
  assert.equal(down.status, 503);
  // The upstream status reaches the client, so a report says something useful.
  assert.equal(down.body.upstreamStatus, 503);

  const unknown = describeFplFailure(new Error("boom"), "That league");
  assert.equal(unknown.status, 503);
});
