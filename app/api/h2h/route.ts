import { describeFplFailure, logFplFailure } from "../../../lib/providers/fpl-request";
import type { DifferentialPlayer, HeadToHeadResponse } from "../../../lib/contracts/live";
import { applyAutomaticSubs } from "../../../lib/auto-subs";
import { provisionalBonus } from "../../../lib/live-bonus";
import {
  fixtureIsOver,
  liveEntryScore,
  livePointsFor,
  substitutionContext,
  type LiveContext,
} from "../../../lib/live-standings";
import { OfficialFplLeagueProvider } from "../../../lib/providers/league-provider";
import {
  OfficialFplLiveProvider,
  type EntryPicks,
  type LiveFixture,
  type LivePlayerMeta,
} from "../../../lib/providers/live-provider";

/**
 * Head-to-head differentials.
 *
 * Only the players the two managers hold differently can change the result, so
 * that is all this returns: the captaincy split, what each owns alone, and a
 * count of the shared players that cancel out. Listing thirty names when seven
 * of them are identical is what makes a live race unreadable.
 */
export const maxDuration = 60;

function fixtureFor(player: LivePlayerMeta | undefined, fixtures: LiveFixture[]) {
  if (!player) return null;
  const theirs = fixtures.filter(
    (fixture) => fixture.homeTeam === player.team || fixture.awayTeam === player.team,
  );
  // An unfinished fixture is the one that still matters.
  return theirs.find((fixture) => !fixtureIsOver(fixture)) ?? theirs[0] ?? null;
}

function summarise(entry: EntryPicks, context: LiveContext) {
  const score = liveEntryScore(entry, context);
  return { points: score.points, netPoints: score.netPoints, transferCost: score.transferCost };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const youId = Number(url.searchParams.get("you"));
  const themId = Number(url.searchParams.get("them"));
  if (![youId, themId].every((id) => Number.isInteger(id) && id > 0)) {
    return Response.json(
      { error: "Invalid team IDs", detail: "Provide both `you` and `them` as team IDs." },
      { status: 400 },
    );
  }

  try {
    const live = new OfficialFplLiveProvider();
    const status = await live.loadEventStatus();
    if (!status) {
      return Response.json(
        { error: "No Gameweek to compare", detail: "The season has not started." },
        { status: 404 },
      );
    }

    const leagues = new OfficialFplLeagueProvider();
    const [yourPicks, theirPicks, points, fixtures, meta, youEntry, themEntry] = await Promise.all([
      live.loadPicks(youId, status.event),
      live.loadPicks(themId, status.event),
      live.loadLivePoints(status.event),
      live.loadFixtures(status.event),
      live.loadPlayerMeta(),
      leagues.loadManager(youId),
      leagues.loadManager(themId),
    ]);

    if (!yourPicks || !theirPicks) {
      return Response.json(
        {
          error: "Picks unavailable",
          detail: `One of these teams has no squad published for Gameweek ${status.event}.`,
        },
        { status: 404 },
      );
    }

    const liveByPlayer = new Map(points.map((player) => [player.playerId, player]));
    const metaById = new Map(meta.map((player) => [player.playerId, player]));
    const teamShort = new Map(meta.map((player) => [player.team, player.teamShort]));
    // The eleven each manager is actually scoring on, substitutions included.
    const context: LiveContext = {
      liveByPlayer,
      meta: metaById,
      fixtures,
      teamShort,
      provisionalBonus: provisionalBonus(points, fixtures),
    };
    const rules = substitutionContext(context);
    const yours = applyAutomaticSubs(yourPicks, rules).multipliers;
    const theirs = applyAutomaticSubs(theirPicks, rules).multipliers;

    const captaincy: DifferentialPlayer[] = [];
    const onlyYou: DifferentialPlayer[] = [];
    const onlyThem: DifferentialPlayer[] = [];
    let sharedCount = 0;
    let sharedPoints = 0;

    for (const playerId of new Set([...yours.keys(), ...theirs.keys()])) {
      const yourMultiplier = yours.get(playerId) ?? 0;
      const theirMultiplier = theirs.get(playerId) ?? 0;
      if (yourMultiplier === 0 && theirMultiplier === 0) continue;

      const scored = livePointsFor(playerId, context);
      if (yourMultiplier === theirMultiplier) {
        sharedCount += 1;
        sharedPoints += scored * yourMultiplier;
        continue;
      }

      const player = metaById.get(playerId);
      const fixture = fixtureFor(player, fixtures);
      const row: DifferentialPlayer = {
        playerId,
        name: player?.name ?? `Player ${playerId}`,
        team: player?.teamShort ?? "",
        position: player?.position ?? "MID",
        points: scored,
        yourMultiplier,
        theirMultiplier,
        swing: scored * (yourMultiplier - theirMultiplier),
        status: !fixture || !fixture.started
          ? "To play"
          : fixtureIsOver(fixture)
            ? "Played"
            : "Playing",
        fixture: fixture
          ? `${teamShort.get(fixture.homeTeam) ?? "?"} v ${teamShort.get(fixture.awayTeam) ?? "?"}`
          : "",
        kickoff: fixture?.kickoff ?? null,
      };

      if (yourMultiplier > 0 && theirMultiplier > 0) captaincy.push(row);
      else if (yourMultiplier > 0) onlyYou.push(row);
      else onlyThem.push(row);
    }

    const byImpact = (a: DifferentialPlayer, b: DifferentialPlayer) =>
      Math.abs(b.swing) - Math.abs(a.swing) || a.name.localeCompare(b.name);

    const response: HeadToHeadResponse = {
      event: status.event,
      started: status.started,
      finished: status.finished,
      retrievedAt: new Date().toISOString(),
      you: {
        entryId: youId,
        teamName: youEntry.teamName,
        managerName: youEntry.managerName,
        ...summarise(yourPicks, context),
      },
      them: {
        entryId: themId,
        teamName: themEntry.teamName,
        managerName: themEntry.managerName,
        ...summarise(theirPicks, context),
      },
      shared: { count: sharedCount, points: sharedPoints },
      captaincy: captaincy.sort(byImpact),
      onlyYou: onlyYou.sort(byImpact),
      onlyThem: onlyThem.sort(byImpact),
      provenance: {
        source: "Fantasy Premier League public web data",
        requestUrls: live.requestUrls.slice(0, 8),
      },
    };

    return Response.json(response, {
      headers: { "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=120" },
    });
  } catch (error) {
    logFplFailure("h2h", error);
    const failure = describeFplFailure(error, "One of those teams");
    return Response.json(failure.body, { status: failure.status });
  }
}
