/**
 * One way in to the official feed.
 *
 * The public FPL API fails in ways that are not the caller's fault: a brief
 * 503 while it redeploys, a 429 when several screens ask at once, a dropped
 * connection. Collapsing all of those into "the feed did not respond" tells
 * nobody anything, so this keeps the status on the error and retries the
 * failures that are worth retrying.
 */

export class FplRequestError extends Error {
  /** The upstream status, or 0 when the request never completed. */
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string, cause?: unknown) {
    super(`The official FPL feed returned ${status || "no response"} for ${url}`);
    this.name = "FplRequestError";
    this.status = status;
    this.url = url;
    this.cause = cause;
  }
}

/** Statuses worth asking again about; the rest are answers, not failures. */
function isTransient(status: number) {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

function backoffMs(attempt: number, retryAfter: string | null) {
  const header = Number(retryAfter);
  // Honour a Retry-After the feed sends, within reason.
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 3000);
  return 300 * 2 ** attempt;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches JSON from the official feed, retrying a transient failure twice.
 *
 * Retries stay small on purpose: a league analysis makes one request per
 * manager, and a retry storm against a public API is worse than a failed
 * screen.
 */
export async function fetchFpl<T>(
  url: string,
  revalidate: number,
  attempts = 3,
): Promise<T> {
  let lastStatus = 0;
  let lastCause: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "NinetyPlus/3.0" },
        next: { revalidate },
      });
    } catch (error) {
      lastStatus = 0;
      lastCause = error;
      if (attempt < attempts - 1) await sleep(backoffMs(attempt, null));
      continue;
    }

    if (response.ok) return (await response.json()) as T;

    lastStatus = response.status;
    if (!isTransient(response.status) || attempt === attempts - 1) {
      throw new FplRequestError(response.status, url);
    }
    await sleep(backoffMs(attempt, response.headers.get("retry-after")));
  }

  throw new FplRequestError(lastStatus, url, lastCause);
}

/** What a route should say and return when the feed fails. */
export function describeFplFailure(error: unknown, subject: string) {
  const status = error instanceof FplRequestError ? error.status : 503;

  if (status === 404) {
    return {
      status: 404,
      body: {
        error: "Not found",
        detail: `${subject} does not exist, or it is private.`,
        upstreamStatus: status,
      },
    };
  }
  if (status === 429) {
    return {
      status: 429,
      body: {
        error: "The official feed is rate limiting us",
        detail: "Too many requests went out at once. Try again in a minute.",
        upstreamStatus: status,
      },
    };
  }
  return {
    status: 503,
    body: {
      error: "The official feed is unavailable",
      detail:
        status === 0
          ? "The request to the official FPL feed did not complete."
          : `The official FPL feed answered ${status}. This is usually brief — try again.`,
      upstreamStatus: status,
    },
  };
}

/** Puts the real cause in the server log, where the generic reply cannot. */
export function logFplFailure(route: string, error: unknown) {
  const detail = error instanceof FplRequestError
    ? `${error.status} ${error.url}`
    : error instanceof Error
      ? error.message
      : String(error);
  console.error(`[${route}] official feed failed: ${detail}`);
}
