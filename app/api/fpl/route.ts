import type { FplProjectionResponse } from "../../../lib/contracts/fpl";
import {
  buildProjectionContext,
  buildTeamOutlook,
  projectExpectedMinutesForSquad,
  projectPlayer,
  validateProjectionData,
} from "../../../lib/fpl-model";
import {
  OfficialFplProvider,
  StoredFplProvider,
} from "../../../lib/providers/fpl-provider";
import { RATE_MODEL_VERSION } from "../../../lib/player-rates";
import { TEAM_STRENGTH_MODEL_VERSION } from "../../../lib/team-strength";
import { WORKLOAD_MODEL_VERSION } from "../../../lib/workload";

function createProvider() {
  const dataApiUrl = process.env.FPL_DATA_API_URL;
  return dataApiUrl ? new StoredFplProvider(dataApiUrl) : new OfficialFplProvider();
}

export async function GET() {
  try {
    const provider = createProvider();
    const snapshot = await provider.loadCurrentSnapshot();
    const teams = new Map(snapshot.teams.map((team) => [team.id, team.short_name]));
    const nextEvent =
      snapshot.events.find((event) => event.is_next)?.id ??
      snapshot.events.find((event) => !event.finished)?.id ??
      1;
    const expectedMinutesByPlayer = projectExpectedMinutesForSquad(
      snapshot.elements,
      nextEvent === 1 ? 38 : nextEvent - 1,
      snapshot.expectedMinutesByPlayer,
    );
    const context = buildProjectionContext(
      snapshot.elements,
      expectedMinutesByPlayer,
      snapshot.scoringConfig,
    );
    const players = snapshot.elements
      .map((player) =>
        projectPlayer(
          player,
          snapshot.fixtures,
          teams,
          nextEvent,
          expectedMinutesByPlayer.get(Number(player.id)),
          snapshot.matchForecastsByFixture,
          snapshot.pointsForecastsByPlayer?.get(Number(player.id)),
          context,
        ),
      )
      .sort((a, b) => b.xp3 - a.xp3);
    const dataQuality = validateProjectionData(players, snapshot.fixtures);
    if (!dataQuality.valid) throw new Error(`FPL data quality failed: ${dataQuality.issues.join("; ")}`);

    const response: FplProjectionResponse = {
      players,
      source: "official-fpl",
      model: {
        version: "component-xp-v1",
        baseline: true,
        horizon: 3,
        playerCount: players.length,
        features: [
          "additive FPL scoring components",
          "shrunk per-90 xG/xA rates",
          "squad-derived team attack and defence",
          "Poisson clean sheets and goals conceded",
          "defensive-contribution threshold probability",
          "BPS-implied bonus",
          "expected minutes",
          "international workload",
          "availability",
          "venue",
        ],
        scoringRulesVersion: context.scoring.version,
        scoringRulesSource: context.scoring.source,
        rateModelVersion: RATE_MODEL_VERSION,
        teamStrengthVersion: TEAM_STRENGTH_MODEL_VERSION,
        workloadVersion: WORKLOAD_MODEL_VERSION,
        workloadAdjustedCount: players.filter(
          (player) => player.expectedMinutes.modelVersion === "expected-minutes-workload-v1",
        ).length,
        expectedMinutesVersion:
          players.some((player) => player.expectedMinutes.modelVersion === "expected-minutes-team-lineup-v1")
            ? "expected-minutes-team-lineup-v1"
            : players.some((player) => player.expectedMinutes.modelVersion === "expected-minutes-team-opportunity-v1")
              ? "expected-minutes-team-opportunity-v1"
            : players[0]?.expectedMinutes.modelVersion ?? "expected-minutes-baseline-v1",
        teamOpportunityAdjustedCount: players.filter(
          (player) => player.expectedMinutes.reasons.some(
            (reason) => reason.toLowerCase().includes("team opportunity:"),
          ),
        ).length,
        teamLineupAdjustedCount: players.filter(
          (player) => player.expectedMinutes.modelVersion === "expected-minutes-team-lineup-v1",
        ).length,
        backtest: snapshot.backtest,
        teamModelVersion: snapshot.matchForecastsByFixture?.size
          ? "time-decayed-poisson-v1"
          : undefined,
        pointsModelVersion: snapshot.pointsForecastsByPlayer?.size
          ? "correlated-player-points-monte-carlo-v1"
          : undefined,
        rulesVersion: snapshot.pointsForecastsByPlayer?.size
          ? "fpl-2026-27-v1"
          : undefined,
        simulationCount: snapshot.pointsForecastsByPlayer?.values().next().value?.[0]
          ?.simulationCount,
        eventModelVersion: snapshot.pointsForecastsByPlayer?.values().next().value?.[0]
          ?.eventModelVersion,
      },
      nextEvent,
      nextDeadline:
        snapshot.events.find((event) => event.id === nextEvent)?.deadline_time ?? null,
      teamOutlook: buildTeamOutlook(teams, snapshot.fixtures, nextEvent, context),
      updatedAt: snapshot.provenance.retrievedAt,
      provenance: snapshot.provenance,
      dataQuality,
    };
    return Response.json(response, {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=900, stale-while-revalidate=1800",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live feed unavailable";
    return Response.json({ error: "Live feed unavailable", detail: message }, { status: 503 });
  }
}
