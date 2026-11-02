"use client";

import { useMemo, useState } from "react";
import type { LeagueInsightsResponse } from "../../lib/contracts/leagues";
import { AlertToggles, BadgeGrid, MonthsWon, SeasonMonths } from "../_components/leagues/awards";
import { ConnectCard } from "../_components/leagues/connect";
import { gameweekRangeLabel } from "../_components/leagues/format";
import { LeagueSwitcher } from "../_components/leagues/league-switcher";
import { ManagerSheet } from "../_components/leagues/manager-sheet";
import { MonthTabs, monthChoices } from "../_components/leagues/month-tabs";
import { MonthHero } from "../_components/leagues/month-hero";
import { RaceChart } from "../_components/leagues/race-chart";
import { StandingsList, StandingsTable, standingFor } from "../_components/leagues/standings";
import { monthWinChance } from "../_components/leagues/win-chance";
import { mergeLiveIntoMonth } from "../../lib/live-standings";
import { updatedAgoLabel, useLiveLeague } from "../_state/use-live-league";
import {
  Button,
  Card,
  CardHead,
  EmptyState,
  LiveDot,
  SegmentedControl,
  Skeleton,
  SkeletonRows,
} from "../_components/ui";
import { useAppState, type Player } from "../_state/app-state";

function LoadingLeague() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton height={132} className="rounded-lg" />
      <Card padded={false}>
        <SkeletonRows rows={6} />
      </Card>
    </div>
  );
}

/** The live strip: what the feed knows, and how long ago it knew it. */
function LiveStrip({
  event,
  summary,
  secondsAgo,
  onRefresh,
}: {
  event: number;
  summary: string;
  secondsAgo: number | null;
  onRefresh: () => void;
}) {
  return (
    <div
      aria-live="polite"
      className="flex items-center gap-3 rounded-md border border-border bg-surface p-3 shadow-[var(--shadow-sm)]"
    >
      <LiveDot />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="t-headline">
          GW {event} live · {summary}
        </span>
        <span className="t-body-sm text-text-muted">{updatedAgoLabel(secondsAgo)}</span>
      </div>
      <Button size="sm" onClick={onRefresh}>
        Refresh
      </Button>
    </div>
  );
}

function ThisMonth({
  insights,
  youEntryId,
  leagueId,
  players,
}: {
  insights: LeagueInsightsResponse;
  youEntryId: number | null;
  leagueId: number | null;
  players: Player[];
}) {
  const choices = monthChoices(insights.months, insights.upcomingMonths);
  const [monthKey, setMonthKey] = useState<string | null>(null);
  const [sheetEntryId, setSheetEntryId] = useState<number | null>(null);
  const live = useLiveLeague(leagueId);

  const active =
    choices.find((choice) => choice.key === monthKey)
    ?? choices.find((choice) => choice.kind === "played" && choice.result.month.current)
    ?? choices[choices.length - 1];

  // History is authoritative once a Gameweek is checked, so the live feed only
  // folds in while it is still provisional.
  const liveIsRelevant = Boolean(live.data?.started && !live.data.dataChecked);
  const played = active?.kind === "played" ? active.result : null;
  const result =
    played && liveIsRelevant && live.data
      ? mergeLiveIntoMonth(
          played,
          new Map(
            live.data.managers.map((manager) => [
              manager.entryId,
              { points: manager.points, netPoints: manager.netPoints },
            ]),
          ),
          live.data.event,
        )
      : played;

  /*
   * Simulating the month is the most expensive thing this screen does, so it
   * only runs when the table or the live feed actually moves.
   */
  const chances = useMemo(
    () =>
      result && liveIsRelevant && live.data
        ? monthWinChance({
            result,
            liveByEntry: live.byEntry,
            players,
            insights,
            event: live.data.event,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, liveIsRelevant, live.data?.retrievedAt, players, insights],
  );

  const liveView = liveIsRelevant
    ? { byEntry: live.byEntry, deltas: live.deltas, winChance: chances ?? undefined }
    : undefined;

  if (!active) {
    return (
      <Card>
        <EmptyState icon="calendar" title="No months to show yet">
          Monthly awards unlock once Gameweek 1 has been scored and checked.
        </EmptyState>
      </Card>
    );
  }


  /**
   * The connected manager is not always in the analysed sample of a big
   * league, so fall back to the league's own state rather than reporting
   * "everyone has played" from an absence of data.
   */
  const yourLive = youEntryId === null ? undefined : live.byEntry.get(youEntryId);
  const managersPlaying = (live.data?.managers ?? []).filter(
    (manager) => manager.playersToPlay > 0,
  ).length;
  const liveSummary = yourLive
    ? yourLive.playersToPlay > 0
      ? `${yourLive.playersToPlay} of your players still to play`
      : "all your players have played"
    : managersPlaying > 0
      ? `${managersPlaying} ${managersPlaying === 1 ? "manager has" : "managers have"} players still to play`
      : "every manager here has played";

  const liveStrip =
    liveIsRelevant && live.data ? (
      <LiveStrip
        event={live.data.event}
        summary={liveSummary}
        secondsAgo={live.secondsAgo}
        onRefresh={live.refresh}
      />
    ) : null;

  return (
    <div className="flex flex-col gap-3">
      {choices.length > 1 && (
        <MonthTabs
          className="expanded:max-w-[320px]"
          choices={choices}
          value={active.key}
          onChange={setMonthKey}
        />
      )}

      {active.kind === "upcoming" ? (
        <Card>
          <EmptyState
            icon="calendar"
            title={`${active.month.name} starts in GW ${active.month.startEvent}`}
            action={<Button variant="primary" href="/squad">{`Plan GW ${active.month.startEvent}`}</Button>}
          >
            Everyone resets to 0 at the deadline. {gameweekRangeLabel(active.month)} count towards{" "}
            {active.month.name}.
          </EmptyState>
        </Card>
      ) : result ? (
        <>
          {liveStrip}
          <MonthHero result={result} youEntryId={youEntryId} winChance={chances} />
          <div className="flex flex-col gap-3 expanded:grid expanded:grid-cols-[minmax(0,1fr)_400px] expanded:items-start">
            <div className="flex flex-col gap-3">
              <StandingsList
                result={result}
                youEntryId={youEntryId}
                live={liveView}
                onSelect={setSheetEntryId}
              />
              <StandingsTable
                result={result}
                youEntryId={youEntryId}
                live={liveView}
                onSelect={setSheetEntryId}
              />
            </div>
            <Card className="hidden expanded:block">
              <CardHead
                title="The race"
                aside={<span className="t-body-sm text-text-muted">Cumulative net</span>}
              />
              <div className="mt-3">
                <RaceChart result={result} youEntryId={youEntryId} />
              </div>
            </Card>
          </div>
          <ManagerSheet
            result={result}
            row={standingFor(result, sheetEntryId)}
            youEntryId={youEntryId}
            leagueId={leagueId}
            live={sheetEntryId === null ? null : live.byEntry.get(sheetEntryId) ?? null}
            onClose={() => setSheetEntryId(null)}
          />
        </>
      ) : null}
    </div>
  );
}

/** Leagues: monthly awards and manager insight for the people you actually play against. */
export function LeaguesView() {
  const {
    manager,
    managerLeagues,
    teamIdInput,
    setTeamIdInput,
    connectTeam,
    connectStatus,
    connectError,
    selectedLeagueId,
    leagueInsights,
    leagueStatus,
    openLeague,
    disconnectTeam,
    players,
  } = useAppState();
  const [tab, setTab] = useState<"month" | "season">("month");

  if (!manager) {
    return (
      <ConnectCard
        teamIdInput={teamIdInput}
        setTeamIdInput={setTeamIdInput}
        connect={(input) => void connectTeam(input)}
        status={connectStatus}
        error={connectError}
      />
    );
  }

  const youEntryId = manager.entryId;
  const seasonBadges = (leagueInsights?.badges ?? []).filter(
    (badge) => badge.kind !== "manager-of-the-month",
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 expanded:flex-row expanded:items-center expanded:justify-between">
        <LeagueSwitcher
          leagues={managerLeagues}
          selectedId={selectedLeagueId}
          selectedName={leagueInsights?.league.name ?? "Choose a league"}
          managerCount={leagueInsights?.league.analysedCount}
          onSelect={(id) => void openLeague(id)}
        />
        <div className="flex items-center gap-2">
          <span className="t-body-sm truncate text-text-muted">
            {manager.teamName} · {manager.managerName}
          </span>
          <Button size="sm" onClick={disconnectTeam}>
            Disconnect
          </Button>
        </div>
      </div>

      <SegmentedControl
        className="expanded:max-w-[420px]"
        label="League view"
        value={tab}
        onChange={setTab}
        options={[
          { value: "month", label: "This month" },
          { value: "season", label: "Season & awards" },
        ]}
      />

      {leagueStatus === "loading" && <LoadingLeague />}

      {leagueStatus === "error" && (
        <Card>
          <EmptyState icon="alert" title="That league could not be loaded">
            It may be private, or the official feed may be refusing requests right now.
          </EmptyState>
        </Card>
      )}

      {leagueStatus === "idle" && !leagueInsights && (
        <Card>
          <EmptyState icon="trophy" title="Choose a league">
            Monthly awards and manager insight appear here once you pick one.
          </EmptyState>
        </Card>
      )}

      {leagueStatus === "idle" && leagueInsights && (
        <>
          {leagueInsights.completedGameweeks === 0 ? (
            <Card>
              <EmptyState
                icon="calendar"
                title="The season has not started yet"
                action={<Button variant="primary" href="/squad">Plan your squad</Button>}
              >
                Monthly awards unlock once Gameweek 1 is scored.{" "}
                {leagueInsights.league.entryCount > 0
                  ? `${leagueInsights.league.entryCount} ${leagueInsights.league.entryCount === 1 ? "manager is" : "managers are"} ready to go.`
                  : "Standings appear here once the official feed ranks this league."}
              </EmptyState>
            </Card>
          ) : tab === "month" ? (
            <ThisMonth
              insights={leagueInsights}
              youEntryId={youEntryId}
              leagueId={selectedLeagueId}
              players={players}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <SeasonMonths insights={leagueInsights} youEntryId={youEntryId} />
              <MonthsWon badges={leagueInsights.badges} youEntryId={youEntryId} />
              <BadgeGrid badges={seasonBadges} youEntryId={youEntryId} />
              <AlertToggles />
            </div>
          )}

          {leagueInsights.league.truncated && (
            <p className="t-caption m-0 text-text-muted">
              This league is larger than the analysed sample. The top{" "}
              {leagueInsights.league.analysedCount} managers are shown.
            </p>
          )}
          <p className="t-caption m-0 text-text-muted">
            {leagueInsights.provenance.source} · retrieved{" "}
            {new Date(leagueInsights.provenance.retrievedAt).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}
