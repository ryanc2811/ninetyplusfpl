"use client";

import type { Position } from "../../../lib/contracts/fpl";
import type { SquadAsset } from "../../../lib/squad-builder";
import { cn } from "../cn";

const SHIRT_FILL: Record<Position, string> = {
  GK: "var(--shirt-gk)",
  DEF: "var(--shirt)",
  MID: "var(--shirt-mid)",
  FWD: "var(--shirt-fwd)",
};

const ROWS: Position[] = ["GK", "DEF", "MID", "FWD"];

/** A shirt, filled by position so the shape of a formation reads at a glance. */
function Shirt({ position, label }: { position: Position; label: string }) {
  return (
    <svg width="34" height="30" viewBox="0 0 34 30" aria-hidden="true" className="flex-none">
      <path
        d="M11 2 2 6l3 6 4-2v16h16V10l4 2 3-6-9-4a6 6 0 0 1-12 0z"
        fill={SHIRT_FILL[position]}
        stroke="var(--on-shirt)"
        strokeOpacity="0.25"
        strokeWidth="1"
      />
      <text
        x="17"
        y="21"
        textAnchor="middle"
        fontSize="9"
        fontWeight="700"
        fill="var(--on-shirt)"
        fontFamily="var(--mono)"
      >
        {label}
      </text>
    </svg>
  );
}

export type PitchPlayer = SquadAsset & {
  captain?: boolean;
  viceCaptain?: boolean;
  /** The model does not expect them to start. */
  flagged?: boolean;
};

/**
 * The starting eleven, laid out by position.
 *
 * Sized with `aspect-ratio` rather than a fixed height, so the same pitch
 * works on a phone and on a desktop column without a second layout. Every
 * shirt is a real button with the player's whole story in its label, because
 * the tap target is how a squad is edited on a phone.
 */
export function Pitch({
  players,
  selectedId,
  onSelect,
  className,
}: {
  players: PitchPlayer[];
  selectedId: number | null;
  onSelect: (playerId: number) => void;
  className?: string;
}) {
  return (
    <section
      aria-label="Starting eleven"
      className={cn(
        "relative flex aspect-[7/9] w-full flex-col justify-around overflow-hidden rounded-lg p-2 medium:aspect-[5/4]",
        className,
      )}
      style={{
        background:
          "repeating-linear-gradient(var(--pitch) 0 11.11%, var(--pitch-stripe) 11.11% 22.22%)",
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border"
        style={{ borderColor: "var(--pitch-line)" }}
      />
      {ROWS.map((row) => {
        const line = players.filter((player) => player.position === row);
        if (!line.length) return null;
        return (
          <div key={row} className="relative flex items-start justify-evenly gap-1">
            {line.map((player) => {
              const selected = player.id === selectedId;
              return (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => onSelect(player.id)}
                  aria-pressed={selected}
                  aria-label={`${player.name}, ${player.position}, ${player.xp1.toFixed(1)} expected points${player.captain ? ", captain" : ""}${player.flagged ? ", not expected to start" : ""}`}
                  className="np-press flex min-h-[var(--tap-min)] min-w-0 flex-col items-center gap-0.5"
                >
                  <span className="relative">
                    <Shirt position={player.position} label={player.team.slice(0, 3)} />
                    {player.captain && (
                      <span className="t-caption absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-accent font-semibold text-on-accent">
                        C
                      </span>
                    )}
                    {!player.captain && player.viceCaptain && (
                      <span className="t-caption absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-surface font-semibold text-text">
                        V
                      </span>
                    )}
                    {player.flagged && (
                      <span className="t-caption absolute -left-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-warning font-semibold text-on-accent">
                        !
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "t-caption max-w-[72px] truncate rounded-xs px-1.5 py-0.5 font-medium",
                      selected ? "bg-accent text-on-accent" : "bg-surface text-text",
                    )}
                  >
                    {player.name}
                  </span>
                  <span className="t-caption rounded-xs bg-ink/70 px-1 font-mono text-on-ink">
                    {player.xp1.toFixed(1)}
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}
