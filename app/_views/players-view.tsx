"use client";

import Link from "next/link";
import { replacementError } from "../../lib/squad-builder";
import {
  BottomSheet,
  Button,
  Card,
  Chip,
  EmptyState,
  FdrChip,
  Icon,
  PlayerRow,
  SegmentedControl,
  SkeletonRows,
} from "../_components/ui";
import { BREAKDOWN_LABELS, useAppState, type Player } from "../_state/app-state";

const POSITIONS = ["ALL", "GK", "DEF", "MID", "FWD"] as const;

/** The evidence behind one projection, on demand rather than in the row. */
function PlayerSheet({
  player,
  onClose,
}: {
  player: Player | null;
  onClose: () => void;
}) {
  const {
    builderSquad,
    selectedSlot,
    budget,
    chooseReplacement,
    updatedAt,
    pointsModelVersion,
    expectedMinutesVersion,
  } = useAppState();
  if (!player) return null;

  const minutes = player.expectedMinutes;
  const breakdown = player.pointsBreakdown;
  const distribution = player.pointsDistribution;
  const swapError = selectedSlot
    ? replacementError(
        builderSquad,
        selectedSlot.id,
        {
          id: player.id,
          name: player.name,
          team: player.team,
          position: player.position,
          price: player.price,
          xp1: player.xp1,
          xp3: player.xp3,
        },
        budget,
      )
    : null;

  return (
    <BottomSheet
      open
      onClose={onClose}
      label={`${player.name}, why this forecast`}
      header={
        <>
          <span className="t-eyebrow text-text-muted">Why this forecast</span>
          <span className="t-title-2">{player.name}</span>
          <span className="t-body-sm text-text-muted">
            {player.team} · {player.position} · £{player.price.toFixed(1)}m ·{" "}
            {player.ownership.toFixed(1)}% owned
          </span>
        </>
      }
      footer={
        selectedSlot ? (
          <Button
            variant="primary"
            block
            disabled={Boolean(swapError)}
            onClick={() => {
              chooseReplacement({
                id: player.id,
                name: player.name,
                team: player.team,
                position: player.position,
                price: player.price,
                xp1: player.xp1,
                xp3: player.xp3,
              });
              onClose();
            }}
          >
            {swapError ?? `Replace ${selectedSlot.name}`}
          </Button>
        ) : undefined
      }
    >
      {minutes ? (
        <>
          <div className="grid grid-cols-2 gap-2 medium:grid-cols-3">
            {[
              ["Starts", `${minutes.startProbability}%`],
              ["Off the bench", `${minutes.substituteProbability}%`],
              ["No minutes", `${minutes.zeroMinutesProbability}%`],
              ["Reaches 60", `${minutes.sixtyMinuteProbability}%`],
              ["Expected minutes", String(minutes.expectedMinutes)],
              ...(player.cleanSheetProbability !== undefined
                ? [["Clean sheet", `${Math.round(player.cleanSheetProbability * 100)}%`]]
                : []),
              ...(distribution
                ? [
                    [
                      "Floor · median · ceiling",
                      `${distribution.p10Points.toFixed(0)} · ${distribution.medianPoints.toFixed(0)} · ${distribution.p90Points.toFixed(0)}`,
                    ],
                    [
                      "5+ / 10+ points",
                      `${Math.round(distribution.fivePlusProbability * 100)}% / ${Math.round(distribution.tenPlusProbability * 100)}%`,
                    ],
                  ]
                : []),
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5 rounded-sm bg-surface-2 p-3">
                <span className="t-caption text-text-muted">{label}</span>
                <span className="t-data-lg">{value}</span>
              </div>
            ))}
          </div>

          {breakdown && (
            <div className="flex flex-col gap-2">
              <span className="t-eyebrow text-text-muted">Where the points come from</span>
              <div className="flex flex-col">
                {BREAKDOWN_LABELS.filter(([key]) => Math.abs(breakdown[key]) >= 0.01).map(
                  ([key, label]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-3 border-b border-border py-1.5"
                    >
                      <span className="t-body">{label}</span>
                      <span
                        className={breakdown[key] < 0 ? "t-data text-negative" : "t-data"}
                      >
                        {breakdown[key] > 0 ? "+" : ""}
                        {breakdown[key].toFixed(2)}
                      </span>
                    </div>
                  ),
                )}
                <div className="flex items-center justify-between gap-3 py-1.5">
                  <span className="t-headline">Projected</span>
                  <span className="t-data-lg text-positive">{breakdown.total.toFixed(2)}</span>
                </div>
              </div>
              {player.rates && (
                <p className="t-body-sm m-0 text-text-muted">
                  Built from {player.rates.expectedGoals.toFixed(2)} xG and{" "}
                  {player.rates.expectedAssists.toFixed(2)} xA per 90
                  {player.rates.defensiveActions > 0
                    ? `, ${player.rates.defensiveActions.toFixed(1)} defensive actions per 90`
                    : ""}{" "}
                  · {Math.round(player.rates.observationWeight * 100)}% observed,{" "}
                  {Math.round((1 - player.rates.observationWeight) * 100)}% position prior.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <span className="t-eyebrow text-text-muted">Evidence</span>
            {(distribution?.reasons ?? minutes.reasons).map((reason) => (
              <p key={reason} className="t-body m-0 flex gap-2 text-text-muted">
                <Icon name="check" size={16} className="mt-0.5 flex-none text-positive" />
                {reason}
              </p>
            ))}
          </div>

          <p className="t-caption m-0 text-text-muted">
            {pointsModelVersion
              ? "Monte Carlo points model · 2026/27 rules"
              : `Expected minutes: ${expectedMinutesVersion}`}
            {player.fixtures?.length ? ` · next: ${player.fixtures.join(" · ")}` : ""}
            {updatedAt ? ` · retrieved ${new Date(updatedAt).toLocaleString()}` : ""}
          </p>
        </>
      ) : (
        <p className="t-body m-0 text-text-muted">
          Live expected-minutes evidence is unavailable for this player, so the row is using the
          clearly labelled preview fallback.
        </p>
      )}
    </BottomSheet>
  );
}

/** The player lab: the ranking, and the evidence behind each projection. */
export function PlayersView() {
  const {
    shownPlayers,
    players,
    query,
    setQuery,
    position,
    setPosition,
    range,
    setRange,
    visibleCount,
    setVisibleCount,
    selectedPlayerId,
    setSelectedPlayerId,
    selectedSlot,
    setSelectedSlotId,
    teamOutlook,
    feedStatus,
    pointsModelVersion,
    builderSquad,
  } = useAppState();

  const difficultyByTeam = new Map(
    teamOutlook.map((team) => [team.team, team.fixtures[0]?.difficulty ?? 3]),
  );
  const owned = new Set(builderSquad.map((asset) => asset.id));
  const selected = players.find((player) => player.id === selectedPlayerId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex min-h-[var(--control-md)] items-center gap-2 rounded-sm border border-border-strong bg-surface px-3">
        <Icon name="search" className="text-text-muted" />
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setVisibleCount(40);
          }}
          placeholder="Search players or clubs"
          aria-label="Search players"
          className="t-input w-full border-0 bg-transparent text-text outline-none placeholder:text-text-disabled"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        {POSITIONS.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={position === item}
            onClick={() => {
              setPosition(item);
              setVisibleCount(40);
            }}
            className={`np-press t-label min-h-[var(--tap-min)] rounded-full border px-3 ${
              position === item
                ? "border-transparent bg-ink text-on-ink"
                : "border-border-strong bg-surface text-text"
            }`}
          >
            {item === "ALL" ? "All" : item}
          </button>
        ))}
      </div>

      {selectedSlot && (
        <div className="flex items-center gap-2 rounded-sm bg-warning-soft px-3 py-2">
          <Icon name="alert" size={16} className="flex-none text-warning" />
          <span className="t-body-sm flex-1">
            Replacing <b>{selectedSlot.name}</b> · {selectedSlot.position} only
          </span>
          <button
            type="button"
            onClick={() => setSelectedSlotId(null)}
            className="t-label np-press min-h-[var(--tap-min)] px-2 text-positive"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="t-body-sm text-text-muted">
          {shownPlayers.length} players · sorted by xP
        </span>
        <SegmentedControl
          className="w-[200px]"
          label="Horizon"
          value={String(range)}
          onChange={(next) => {
            setRange(Number(next) as 1 | 3);
            setVisibleCount(40);
          }}
          options={[
            { value: "1", label: "Next GW" },
            { value: "3", label: "Next 3" },
          ]}
        />
      </div>

      <Card padded={false}>
        {feedStatus === "loading" && <SkeletonRows rows={8} />}
        {feedStatus !== "loading"
          && shownPlayers.slice(0, visibleCount).map((player) => (
            <PlayerRow
              key={player.id}
              onClick={() => setSelectedPlayerId(player.id)}
              ariaLabel={`${player.name}, ${player.team}, ${player.position}, £${player.price.toFixed(1)}m, ${(range === 1 ? player.xp1 : player.xp3).toFixed(1)} expected points`}
              lead={
                <span className="t-caption grid h-9 w-9 place-items-center rounded-full bg-surface-2 font-mono">
                  {player.team}
                </span>
              }
              title={
                <>
                  {player.name}
                  {owned.has(player.id) && <Chip tone="positive">Yours</Chip>}
                  {player.tag && <Chip tone="neutral">{player.tag}</Chip>}
                </>
              }
              meta={
                <span className="flex items-center gap-1.5">
                  {player.position} · £{player.price.toFixed(1)}m
                  <FdrChip
                    opponent={player.opponent}
                    venue={player.venue}
                    difficulty={difficultyByTeam.get(player.team) ?? 3}
                  />
                </span>
              }
              figure={(range === 1 ? player.xp1 : player.xp3).toFixed(1)}
              figureNote="xP"
            />
          ))}
        {feedStatus !== "loading" && !shownPlayers.length && (
          <EmptyState icon="search" title="No players match those filters">
            Clear the search or choose another position.
          </EmptyState>
        )}
        {visibleCount < shownPlayers.length && (
          <button
            type="button"
            onClick={() => setVisibleCount(visibleCount + 40)}
            className="np-press t-label min-h-[var(--tap-min)] w-full border-t border-border bg-surface-2 text-positive"
          >
            Show 40 more · {shownPlayers.length - visibleCount} remaining
          </button>
        )}
      </Card>

      <p className="t-caption m-0 text-text-muted">
        {pointsModelVersion ? "Probabilistic points model" : "Baseline model"} · tap a player for
        the points breakdown and the evidence behind it.{" "}
        <Link href="/squad" className="text-positive">
          Back to your squad
        </Link>
      </p>

      <PlayerSheet player={selected} onClose={() => setSelectedPlayerId(null)} />
    </div>
  );
}
