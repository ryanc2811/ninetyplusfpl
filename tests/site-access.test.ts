import assert from "node:assert/strict";
import test from "node:test";
import {
  SESSION_COOKIE,
  clearedCookieHeader,
  cookieHeader,
  constantTimeEqual,
  createSessionToken,
  isPublicPath,
  passphraseMatches,
  sessionTokenIsValid,
} from "../lib/site-access.ts";

const PASSPHRASE = "a-shared-passphrase";

test("a token this passphrase made is accepted", async () => {
  const token = await createSessionToken(PASSPHRASE);
  assert.equal(await sessionTokenIsValid(token, PASSPHRASE), true);
});

test("a token signed with a different passphrase is refused", async () => {
  const token = await createSessionToken("someone else's passphrase");
  assert.equal(await sessionTokenIsValid(token, PASSPHRASE), false);
});

test("changing the passphrase signs everyone out", async () => {
  const token = await createSessionToken(PASSPHRASE);
  assert.equal(await sessionTokenIsValid(token, `${PASSPHRASE}!`), false);
});

test("an expired token is refused even though it is properly signed", async () => {
  const now = Date.UTC(2026, 0, 1);
  const token = await createSessionToken(PASSPHRASE, now, 60);
  assert.equal(await sessionTokenIsValid(token, PASSPHRASE, now + 30_000), true);
  assert.equal(await sessionTokenIsValid(token, PASSPHRASE, now + 61_000), false);
});

test("an expiry cannot be extended without the passphrase", async () => {
  const token = await createSessionToken(PASSPHRASE, Date.UTC(2026, 0, 1), 60);
  const [, signature] = token.split(".");
  const forged = `${Math.floor(Date.UTC(2030, 0, 1) / 1000)}.${signature}`;
  assert.equal(await sessionTokenIsValid(forged, PASSPHRASE), false);
});

test("a missing or malformed cookie is refused rather than throwing", async () => {
  for (const token of [undefined, "", "nonsense", ".", "abc.def", "123"]) {
    assert.equal(await sessionTokenIsValid(token, PASSPHRASE), false);
  }
});

test("the passphrase check accepts only the passphrase", async () => {
  assert.equal(await passphraseMatches(PASSPHRASE, PASSPHRASE), true);
  assert.equal(await passphraseMatches("wrong", PASSPHRASE), false);
  assert.equal(await passphraseMatches("", PASSPHRASE), false);
  // A prefix of the real passphrase must not pass.
  assert.equal(await passphraseMatches(PASSPHRASE.slice(0, -1), PASSPHRASE), false);
});

test("comparison does not short-circuit on length", () => {
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
  assert.equal(constantTimeEqual("abc", "abcd"), false);
});

test("only the paths needed to sign in are public", () => {
  for (const path of ["/login", "/api/session", "/favicon.svg", "/assets/app.css", "/_next/x"]) {
    assert.equal(isPublicPath(path), true, path);
  }
  for (const path of ["/", "/squad", "/leagues", "/api/leagues/1", "/api/fpl", "/leagues/1/h2h/2"]) {
    assert.equal(isPublicPath(path), false, path);
  }
});

test("the cookie is locked down, and clearing it expires it immediately", () => {
  const header = cookieHeader("token", true);
  assert.match(header, new RegExp(`^${SESSION_COOKIE}=token`));
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Secure/);
  // Plain http, as in local development, cannot set a Secure cookie.
  assert.doesNotMatch(cookieHeader("token", false), /Secure/);
  assert.match(clearedCookieHeader(true), /Max-Age=0/);
});
