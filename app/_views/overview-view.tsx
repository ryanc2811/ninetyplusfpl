"use client";

import { useState } from "react";
import Link from "next/link";
import { firstName, ordinal } from "../_components/leagues/format";
import { FixtureTicker } from "../_components/squad/fixture-ticker";
import { flaggedPlayers, likelyRange } from "../_components/squad/projection";
import {
  Button,
  Card,
  CardHead,
  Chip,
  BottomSheet,
  Icon,
  LiveDot,
  StatCard,
} from "../_components/ui";
import { useAppState } from "../_state/app-state";

/** The league race, as a card you can act on rather than a table to read. */
function LiveMonthCard() {
  const { leagueInsights, currentMonth, manager, selectedLeagueId } = useAppState();
  if (!manager) {
    return (
      <Card className="flex flex-col gap-3">
        <CardHead eyebrow="Manager of the Month" title="Connect your team" />
        <p className="t-body m-0 text-text-muted">
          Link your FPL team to see your mini-league race, your real squad in the builder and the
          monthly awards.
        </p>
        <Button variant="primary" href="/leagues">
          Connect
        </Button>
      </Card>
    );
  }
  if (!leagueInsights || !currentMonth) return null;

  const rows = currentMonth.standings;
  const you = rows.find((row) => row.entryId === manager.entryId);
  const leader = rows[0];
  const around = you
    ? rows.slice(Math.max(0, rows.indexOf(you) - 1), Math.max(0, rows.indexOf(you) - 1) + 3)
    : rows.slice(0, 3);

  const headline = you
    ? you.rank === 1
      ? `Top of ${currentMonth.month.name}`
      : `${ordinal(you.rank)}, ${leader.netPoints - you.netPoints} behind ${firstName(leader.managerName)}`
    : `${firstName(leader?.managerName ?? "")} leads ${currentMonth.month.name}`;

  return (
    <Link
      href="/leagues"
      aria-label={`${currentMonth.month.name} race. ${headline}. Open the league.`}
      className="np-press flex flex-col gap-3 rounded-lg bg-ink p-4 text-on-ink no-underline medium:p-5"
    >
      <span className="t-eyebrow flex items-center justify-between gap-2 text-on-ink-muted">
        <span className="truncate">
          Manager of the Month · {currentMonth.month.name}
        </span>
        {!currentMonth.month.complete && (
          <span className="flex items-center gap-1.5 text-accent">
            <LiveDot />
            Live
          </span>
        )}
      </span>
      <span className="t-title-1 font-serif">{headline}</span>
      <span className="flex flex-col">
        {around.map((row) => {
          const isYou = row.entryId === manager.entryId;
          return (
            <span
              key={row.entryId}
              className={`flex items-center gap-3 border-t border-white/10 py-1.5 ${isYou ? "text-accent" : ""}`}
            >
              <span className="t-data w-5">{row.rank}</span>
              <span className="t-body flex-1 truncate">
                {isYou ? "You" : row.managerName || row.teamName}
              </span>
              <span className="t-data-lg">{row.netPoints}</span>
            </span>
          );
        })}
      </span>
      <span className="t-body-sm flex items-center justify-between gap-2 text-on-ink-muted">
        <span className="truncate">{leagueInsights.league.name}</span>
        <span className="flex items-center gap-1 text-accent">
          Live table
          <Icon name="chevronRight" size={16} />
        </span>
      </span>
      {selectedLeagueId === null && <span className="sr-only">No league selected</span>}
    </Link>
  );
}

/** The decision room: what the model thinks, and the one move it would make next. */
export function OverviewView() {
  const {
    nextEvent,
    animatedGw1,
    projectedGw3,
    squadCapture,
    builderStarters,
    builderSquad,
    builderValidation,
    bankRemaining,
    captainId,
    captain,
    captainEdge,
    players,
    transferSuggestion,
    teamOutlook,
    nextPlannedChip,
    live,
    feedStatus,
  } = useAppState();
  const [whySheet, setWhySheet] = useState(false);

  const range = likelyRange(builderStarters, players, captainId);
  const flagged = flaggedPlayers(builderSquad, players);

  return (
    <div className="flex flex-col gap-3 medium:gap-4">
      <LiveMonthCard />

      <section className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 shadow-[var(--shadow-sm)] medium:p-5">
        <span className="t-eyebrow text-text-muted">GW {nextEvent} · your projection</span>
        <span className="t-display">
          {animatedGw1} <span className="t-title-2 align-baseline">pts</span>
        </span>
        <span className="t-body-sm text-text-muted">
          {range ? `Likely range ${range.low}–${range.high} · ` : ""}
          {squadCapture}% of your squad&apos;s points are in the XI
        </span>
      </section>

      <Card className="flex flex-col gap-2">
        <span className="t-eyebrow flex items-center gap-1.5 text-text-muted">
          <Icon name="arrowUpRight" size={16} />
          The model suggests
        </span>
        {transferSuggestion ? (
          <>
            <p className="t-title-2 m-0">
              {transferSuggestion.outgoing.name} → {transferSuggestion.incoming.name} adds{" "}
              <span className="text-positive">+{transferSuggestion.gain.toFixed(1)} xP</span> over
              three gameweeks.
            </p>
            <p className="t-body m-0 text-text-muted">
              {transferSuggestion.incoming.name} costs £
              {transferSuggestion.incoming.price.toFixed(1)}m against{" "}
              {transferSuggestion.outgoing.name}&apos;s £
              {transferSuggestion.outgoing.price.toFixed(1)}m, leaving £
              {(bankRemaining + transferSuggestion.outgoing.price - transferSuggestion.incoming.price).toFixed(1)}m
              in the bank.
            </p>
            <div className="mt-1 flex flex-col gap-2 medium:flex-row">
              <Button variant="primary" href="/squad" className="medium:flex-1">
                Make transfer
              </Button>
              <Button onClick={() => setWhySheet(true)} className="medium:flex-1">
                Why?
              </Button>
            </div>
          </>
        ) : (
          <p className="t-body m-0 text-text-muted">
            No legal transfer improves this squad&apos;s three-gameweek projection right now.
          </p>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Bank"
          value={`£${bankRemaining.toFixed(1)}m`}
          footer={`Squad £${builderValidation.cost.toFixed(1)}m`}
          tone={bankRemaining >= 0 ? "default" : "negative"}
        />
        <StatCard
          label="Three gameweeks"
          value={projectedGw3.toFixed(1)}
          unit="xP"
          footer="Starting XI"
        />
        <StatCard
          label="Captain"
          value={captain?.name ?? "—"}
          footer={`+${captainEdge.toFixed(1)} on the next best`}
        />
        <StatCard
          label="Flagged"
          value={String(flagged.length)}
          tone={flagged.length ? "warning" : "default"}
          footer={flagged.length ? `${flagged[0].name}${flagged[0].startProbability !== null ? ` ${flagged[0].startProbability}% to start` : ""}` : "Everyone is expected to start"}
        />
      </div>

      <Card className="flex flex-col gap-3">
        <CardHead
          title="Your fixtures"
          aside={<span className="t-body-sm text-text-muted">Next three</span>}
        />
        <FixtureTicker players={builderStarters} outlook={teamOutlook} />
      </Card>

      {nextPlannedChip && (
        <Card className="flex flex-col gap-2">
          <CardHead
            eyebrow="Chip forecast"
            title={`${nextPlannedChip.chip} · GW ${nextPlannedChip.gameweek}`}
            aside={<Chip tone={nextPlannedChip.locked ? "ink" : "neutral"}>
              {nextPlannedChip.locked ? "Yours" : "Model"}
            </Chip>}
          />
          <p className="t-body m-0 text-text-muted">{nextPlannedChip.rationale}</p>
          <Button href="/chips">Plan all chips</Button>
        </Card>
      )}

      <p className="t-caption m-0 text-text-muted">
        {feedStatus === "loading"
          ? "Connecting to the official feed…"
          : live
            ? "Projections from the official FPL feed."
            : "Live feed unavailable — showing the clearly labelled preview squad."}
      </p>

      <BottomSheet
        open={whySheet && Boolean(transferSuggestion)}
        onClose={() => setWhySheet(false)}
        label="Why this transfer"
        header={
          <>
            <span className="t-eyebrow text-text-muted">Why this transfer</span>
            <span className="t-title-2">
              {transferSuggestion?.outgoing.name} → {transferSuggestion?.incoming.name}
            </span>
          </>
        }
      >
        {transferSuggestion && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-0.5 rounded-sm bg-surface-2 p-3">
                <span className="t-caption text-text-muted">{transferSuggestion.outgoing.name}</span>
                <span className="t-stat">{transferSuggestion.outgoing.xp3.toFixed(1)}</span>
                <span className="t-caption text-text-muted">three-gameweek xP</span>
              </div>
              <div className="flex flex-col gap-0.5 rounded-sm bg-positive-soft p-3">
                <span className="t-caption text-text-muted">{transferSuggestion.incoming.name}</span>
                <span className="t-stat text-positive">
                  {transferSuggestion.incoming.xp3.toFixed(1)}
                </span>
                <span className="t-caption text-text-muted">three-gameweek xP</span>
              </div>
            </div>
            <p className="t-body m-0">
              This is the highest-projected legal replacement at the same position under the
              current budget and the three-players-per-club limit. It does not account for a
              points hit: taking one costs four points, so a gain under four is not worth it on
              its own.
            </p>
            <FixtureTicker
              players={[transferSuggestion.incoming, transferSuggestion.outgoing]}
              outlook={teamOutlook}
              limit={2}
            />
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
