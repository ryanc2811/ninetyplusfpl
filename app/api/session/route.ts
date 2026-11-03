import {
  clearedCookieHeader,
  cookieHeader,
  createSessionToken,
  passphraseMatches,
} from "../../../lib/site-access";

/**
 * The private-preview door.
 *
 * A correct passphrase is exchanged for a signed, HttpOnly cookie; the
 * passphrase itself is never stored in the browser and never sent again.
 */
function isSecure(request: Request) {
  const url = new URL(request.url);
  return url.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
}

export async function POST(request: Request) {
  const passphrase = process.env.SITE_PASSPHRASE;
  if (!passphrase) {
    return Response.json(
      { error: "No passphrase configured", detail: "This deployment is not private." },
      { status: 404 },
    );
  }

  let submitted = "";
  try {
    const body = (await request.json()) as { passphrase?: unknown };
    submitted = typeof body.passphrase === "string" ? body.passphrase : "";
  } catch {
    submitted = "";
  }

  if (!(await passphraseMatches(submitted, passphrase))) {
    // A deliberate pause: this endpoint has no rate limit of its own, and a
    // shared passphrase is worth guessing slowly rather than quickly.
    await new Promise((resolve) => setTimeout(resolve, 600));
    return Response.json(
      { error: "That passphrase is not right", detail: "Check it and try again." },
      { status: 401 },
    );
  }

  return Response.json(
    { ok: true },
    {
      status: 200,
      headers: {
        "Set-Cookie": cookieHeader(await createSessionToken(passphrase), isSecure(request)),
      },
    },
  );
}

/** Signing out: the cookie is expired in place. */
export async function DELETE(request: Request) {
  return Response.json(
    { ok: true },
    { status: 200, headers: { "Set-Cookie": clearedCookieHeader(isSecure(request)) } },
  );
}
