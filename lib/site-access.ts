/**
 * Private-preview access.
 *
 * One shared passphrase keeps the site off the open web while it is being
 * built. It is a door, not a security boundary: everyone who gets in is the
 * same anonymous visitor, there are no accounts, and nothing here protects
 * one person's data from another's. Real sign-in, if it is ever needed, is a
 * different piece of work.
 *
 * The passphrase itself never leaves the server. What the browser holds is an
 * expiry and a signature over it, so a cookie cannot be forged without the
 * passphrase and cannot outlive its own deadline.
 */

export const SESSION_COOKIE = "np_access";

/** Thirty days: long enough not to nag, short enough to expire a stale laptop. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const encoder = new TextEncoder();

/**
 * The signing key is derived from the passphrase rather than configured
 * separately, so there is one secret to set and changing it signs everyone
 * out by construction.
 */
async function signingKey(passphrase: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(`ninety-plus:access:v1:${passphrase}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function base64url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sign(passphrase: string, payload: string) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(passphrase),
    encoder.encode(payload),
  );
  return base64url(signature);
}

/** Compares without leaking, through length or timing, how close a guess was. */
export function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/** True when the submitted passphrase is the configured one. */
export async function passphraseMatches(submitted: string, configured: string) {
  // Comparing signatures rather than the strings keeps the check constant
  // time whatever the two lengths are.
  const [a, b] = await Promise.all([
    sign(configured, submitted),
    sign(configured, configured),
  ]);
  return constantTimeEqual(a, b);
}

export async function createSessionToken(
  passphrase: string,
  now = Date.now(),
  maxAgeSeconds = SESSION_MAX_AGE_SECONDS,
) {
  const expiresAt = Math.floor(now / 1000) + maxAgeSeconds;
  return `${expiresAt}.${await sign(passphrase, String(expiresAt))}`;
}

/** A token is valid when its signature holds and its deadline has not passed. */
export async function sessionTokenIsValid(
  token: string | undefined,
  passphrase: string,
  now = Date.now(),
) {
  if (!token) return false;
  const separator = token.indexOf(".");
  if (separator <= 0) return false;

  const expiresAt = Number(token.slice(0, separator));
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= now) return false;

  const expected = await sign(passphrase, String(expiresAt));
  return constantTimeEqual(token.slice(separator + 1), expected);
}

/** Paths that have to answer before anyone can sign in. */
const PUBLIC_PREFIXES = [
  "/login",
  "/api/session",
  "/_vinext",
  "/_next",
  "/assets",
  "/favicon",
  "/og.png",
  "/robots.txt",
];

export function isPublicPath(pathname: string) {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(prefix),
  );
}

export function cookieHeader(token: string, secure: boolean) {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearedCookieHeader(secure: boolean) {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}
