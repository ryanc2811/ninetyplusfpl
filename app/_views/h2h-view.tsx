"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { DifferentialPlayer, HeadToHeadResponse } from "../../lib/contracts/live";
import { firstName } from "../_components/leagues/format";
import { Button, Card, Chip, EmptyState, Icon, LiveDot, Skeleton } from "../_components/ui";
import { useAppState } from "../_state/app-state";
import { updatedAgoLabel } from "../_state/use-live-league";

const REFRESH = 60_000;

/** Fetches one head-to-head, refreshing while the Gameweek is still running. */
function useHeadToHead(youEntryId: number | null, themEntryId: number) {
  const [data, setData] = useState<HeadToHeadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!youEntryId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(`/api/h2h?you=${youEntryId}&them=${themEntryId}`);
        const payload = (await response.json()) as HeadToHeadResponse & { detail?: string };
        if (cancelled) return;
        if (!response.ok) {
          setError(payload.detail ?? "That comparison could not be loaded.");
          return;
        }
        setData(payload);
        setError(null);
        setFetchedAt(Date.now());
        setNow(Date.now());
        if (payload.started && !payload.finished) timer.current = setTimeout(poll, REFRESH);
      } catch {
        if (!cancelled) setError("The official FPL feed did not respond.");
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [youEntryId, themEntryId]);

  useEffect(() => {
    if (!fetchedAt) return;
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(tick);
  }, [fetchedAt]);

  return {
    data,
    error,
    secondsAgo: fetchedAt === null ? null : Math.max(0, Math.round((now - fetchedAt) / 1000)),
  };
}

function statusTone(status: DifferentialPlayer["status"]) {
  return status === "Played" ? "neutral" : status === "Playing" ? "positive" : "warning";
}

/**
 * How the two managers hold this player. The group already says whose player
 * it is, so only a split ownership needs both sides spelled out.
 */
function multiplierNote(player: DifferentialPlayer, theirName: string) {
  const describe = (multiplier: number) => (multiplier === 3 ? "×3" : multiplier === 2 ? "×2" : "×1");
  if (player.yourMultiplier > 0 && player.theirMultiplier > 0) {
    return `You ${describe(player.yourMultiplier)} · ${theirName} ${describe(player.theirMultiplier)}`;
  }
  return player.yourMultiplier > 0
    ? describe(player.yourMultiplier)
    : `${theirName} ${describe(player.theirMultiplier)}`;
}

function Group({
  title,
  note,
  players,
  theirName,
}: {
  title: string;
  note: string;
  players: DifferentialPlayer[];
  theirName: string;
}) {
  if (!players.length) return null;
  return (
    <Card padded={false}>
      <div className="t-eyebrow flex items-center justify-between bg-surface-2 px-3 py-2 text-text-muted">
        <span>{title}</span>
        <span>{note}</span>
      </div>
      {players.map((player) => (
        <div
          key={player.playerId}
          className="flex min-h-[var(--row-min)] items-center gap-3 border-t border-border px-3 py-2.5"
        >
          <span className="t-caption w-9 flex-none rounded-xs bg-surface-2 px-1 py-1 text-center font-mono">
            {player.position}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="t-headline truncate">{player.name}</span>
            <span className="t-body-sm truncate text-text-muted">
              {multiplierNote(player, theirName)} · {player.fixture}
            </span>
          </span>
          <span className="flex flex-none flex-col items-end gap-1">
            <span className="t-data-lg">{player.points}</span>
            <Chip tone={statusTone(player.status)}>{player.status}</Chip>
          </span>
        </div>
      ))}
    </Card>
  );
}

function Score({
  label,
  points,
  net,
  accent,
}: {
  label: string;
  points: number;
  net: number;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-0.5">
      <span className="t-caption text-on-ink-muted">{label}</span>
      <span className={accent ? "t-display text-accent" : "t-display"}>{points}</span>
      {/* A hit is the only reason the two figures differ. */}
      <span className="t-caption text-on-ink-muted">
        {net === points ? "no hits" : `${net} net`}
      </span>
    </div>
  );
}

/** Head-to-head: only the picks that can still change the result. */
export function HeadToHeadView({ leagueId, entryId }: { leagueId: number; entryId: number }) {
  const { manager } = useAppState();
  const { data, error, secondsAgo } = useHeadToHead(manager?.entryId ?? null, entryId);

  if (!manager) {
    return (
      <Card>
        <EmptyState
          icon="trophy"
          title="Connect your team first"
          action={<Button variant="primary" href="/leagues">Go to Leagues</Button>}
        >
          A head-to-head needs to know which team is yours.
        </EmptyState>
      </Card>
    );
  }

  const back = (
    <Link
      href="/leagues"
      className="np-press t-label inline-flex min-h-[var(--tap-min)] items-center gap-1 text-positive no-underline"
    >
      <Icon name="chevronLeft" size={16} />
      Back to {leagueId ? "the league" : "Leagues"}
    </Link>
  );

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        {back}
        <Card>
          <EmptyState icon="alert" title="That comparison could not be loaded">
            {error}
          </EmptyState>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-3">
        {back}
        <Skeleton height={160} className="rounded-lg" />
        <Skeleton height={220} className="rounded-md" />
      </div>
    );
  }

  const theirName = firstName(data.them.managerName);
  const swing = [...data.captaincy, ...data.onlyYou, ...data.onlyThem].reduce(
    (total, player) => total + player.swing,
    0,
  );
  const toPlay = [...data.captaincy, ...data.onlyYou, ...data.onlyThem].filter(
    (player) => player.status !== "Played",
  );

  return (
    <div className="flex flex-col gap-3">
      {back}

      <section
        aria-label="Live score"
        className="flex flex-col gap-3 rounded-lg bg-ink p-4 text-on-ink medium:p-5"
      >
        <div className="t-eyebrow flex items-center justify-between gap-2 text-on-ink-muted">
          <span className="flex items-center gap-1.5">
            {data.started && !data.finished && <LiveDot />}
            GW {data.event} {data.finished ? "final" : "live"}
          </span>
          <span>{updatedAgoLabel(secondsAgo)}</span>
        </div>
        <div className="flex items-end gap-2">
          <Score label="You" points={data.you.points} net={data.you.netPoints} accent />
          <span className="t-caption pb-6 text-on-ink-muted">v</span>
          <Score label={theirName} points={data.them.points} net={data.them.netPoints} />
        </div>
        <p className="t-body m-0 text-on-ink-muted">
          {swing === 0
            ? "Your differentials are level so far."
            : `Your differentials are ${swing > 0 ? "worth" : "down"} ${Math.abs(swing)} ${
                Math.abs(swing) === 1 ? "point" : "points"
              } ${swing > 0 ? "on" : "against"} ${theirName}.`}
          {toPlay.length > 0 && ` ${toPlay.length} still to play.`}
        </p>
      </section>

      <Group
        title="Captaincy"
        note="Decides it"
        players={data.captaincy}
        theirName={theirName}
      />
      <Group
        title="Only you"
        note={`${data.onlyYou.reduce((total, player) => total + player.swing, 0)} pts`}
        players={data.onlyYou}
        theirName={theirName}
      />
      <Group
        title={`Only ${theirName}`}
        note={`${-data.onlyThem.reduce((total, player) => total + player.swing, 0)} pts`}
        players={data.onlyThem}
        theirName={theirName}
      />

      <Card className="flex items-center gap-3">
        <Icon name="check" className="text-positive" />
        <div className="flex min-w-0 flex-col">
          <span className="t-headline">
            {data.shared.count} shared {data.shared.count === 1 ? "player" : "players"} ·{" "}
            {data.shared.points} pts each
          </span>
          <span className="t-body-sm text-text-muted">
            They cancel out, so only the players above can change the result.
          </span>
        </div>
      </Card>

      <p className="t-caption m-0 text-text-muted">
        {data.provenance.source} · live scores update while the Gameweek is on.
      </p>
    </div>
  );
}
