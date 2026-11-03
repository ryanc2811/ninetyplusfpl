import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isPublicPath, sessionTokenIsValid } from "./lib/site-access";

/**
 * The private-preview gate.
 *
 * Runs in front of every route on both deploy targets, so the API is behind
 * the same door as the screens — the pages would be pointless to protect
 * while `/api/leagues/123` answered anyone who asked.
 *
 * With no `SITE_PASSPHRASE` set the gate is open, which is what local
 * development wants. A deployment that should be private has to set it; the
 * README says so, and nothing silently assumes it.
 */
export default async function proxy(request: NextRequest) {
  const passphrase = process.env.SITE_PASSPHRASE;
  if (!passphrase) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await sessionTokenIsValid(token, passphrase)) return NextResponse.next();

  // An API caller gets an answer it can read; a browser gets the door.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Not signed in", detail: "This preview is private." },
      { status: 401 },
    );
  }

  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  /*
   * Everything except the framework's own assets. The gate re-checks the path
   * itself, so this is only here to keep static files off the edge function.
   */
  matcher: ["/((?!_next/static|_next/image|_vinext|assets|favicon|og.png).*)"],
};
