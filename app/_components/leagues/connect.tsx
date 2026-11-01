"use client";

import { useState } from "react";
import type { LeagueSearchResponse } from "../../api/leagues/[id]/search/route";
import { Button, Card, CardHead, Chip, Icon, SegmentedControl, Skeleton } from "../ui";

function Field({
  label,
  value,
  onChange,
  placeholder,
  prefix,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  prefix: string;
  inputMode?: "numeric" | "text";
}) {
  return (
    <label className="flex min-h-[var(--control-md)] flex-1 items-center gap-2 rounded-sm border border-border-strong bg-surface px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus">
      <span aria-hidden="true" className="t-data text-text-muted">{prefix}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        aria-label={label}
        className="t-input w-full border-0 bg-transparent text-text outline-none placeholder:text-text-disabled"
      />
    </label>
  );
}

/**
 * Finding a team by name.
 *
 * The official API has no global search — a team ID is the only public handle
 * on a manager — so this searches inside a league the manager is already in.
 * Their own league ID is in the URL of that league's standings page, and the
 * results show the manager's name beside the team name so the right one is
 * obvious.
 */
function FindByName({ onPick }: { onPick: (entryId: number) => void }) {
  const [leagueId, setLeagueId] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LeagueSearchResponse | null>(null);

  async function search() {
    const id = Number(leagueId.trim().match(/leagues\/(\d+)/)?.[1] ?? leagueId.replace(/[^\d]/g, ""));
    if (!Number.isInteger(id) || id <= 0) {
      setStatus("error");
      setError("Enter the league ID from the league's standings URL.");
      return;
    }
    if (query.trim().length < 2) {
      setStatus("error");
      setError("Type at least two characters of the team or manager name.");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch(`/api/leagues/${id}/search?q=${encodeURIComponent(query.trim())}`);
      const payload = (await response.json()) as LeagueSearchResponse & { detail?: string };
      if (!response.ok) {
        setStatus("error");
        setError(payload.detail ?? "That league could not be searched.");
        return;
      }
      setResult(payload);
      setStatus("idle");
    } catch {
      setStatus("error");
      setError("The official FPL feed did not respond.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="t-body m-0 text-text-muted">
        The official FPL API has no way to look a team up by name on its own, so search inside a
        league you are in. The league ID is the number in its standings URL:{" "}
        <code className="t-data break-all rounded-xs bg-surface-2 px-1 py-0.5">
          /leagues/<b>123456</b>/standings/c
        </code>
      </p>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <Field
          label="League ID"
          prefix="#"
          value={leagueId}
          onChange={setLeagueId}
          placeholder="League ID, e.g. 123456"
          inputMode="numeric"
        />
        <div className="flex flex-col gap-2 medium:flex-row">
          <Field
            label="Team or manager name"
            prefix="⌕"
            value={query}
            onChange={setQuery}
            placeholder="Team or manager name"
          />
          <Button variant="primary" type="submit" disabled={status === "loading"}>
            {status === "loading" ? "Searching…" : "Search"}
          </Button>
        </div>
      </form>

      {error && <p className="t-body m-0 text-negative">{error}</p>}
      {status === "loading" && <Skeleton height={64} className="rounded-sm" />}

      {result && status === "idle" && (
        <div className="flex flex-col gap-1">
          <span className="t-caption text-text-muted">
            {result.matches.length
              ? `${result.matches.length} of ${result.scanned} teams in ${result.league.name}`
              : `No match in the first ${result.scanned} teams of ${result.league.name}`}
            {result.truncated && " · this league is larger than the pages searched"}
          </span>
          {result.matches.map((match) => (
            <button
              key={match.entryId}
              type="button"
              onClick={() => onPick(match.entryId)}
              className="np-press flex min-h-[var(--row-min)] items-center gap-3 rounded-sm border border-border bg-surface px-3 py-2 text-left"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="t-headline truncate">{match.teamName}</span>
                <span className="t-body-sm truncate text-text-muted">
                  {match.managerName} · rank {match.rank} · {match.total} pts
                </span>
              </span>
              <Chip tone="neutral" mono>#{match.entryId}</Chip>
              <Icon name="chevronRight" className="text-text-muted" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A team ID is public. A password is never asked for, here or anywhere. */
export function ConnectCard({
  teamIdInput,
  setTeamIdInput,
  connect,
  status,
  error,
}: {
  teamIdInput: string;
  setTeamIdInput: (next: string) => void;
  connect: (input: string) => void;
  status: "idle" | "loading" | "error";
  error: string | null;
}) {
  const [mode, setMode] = useState<"id" | "name">("id");

  return (
    <Card className="flex flex-col gap-3">
      <CardHead eyebrow="Connect your squad" title="Link your real FPL team" />
      <p className="t-body m-0 text-text-muted">
        Your squad, your mini-leagues and the monthly awards all come from your public team ID.
        Connecting also loads your real fifteen into the squad builder.
      </p>

      <SegmentedControl
        label="How to connect"
        value={mode}
        onChange={setMode}
        options={[
          { value: "id", label: "Team ID or URL" },
          { value: "name", label: "Search by name" },
        ]}
      />

      {mode === "id" ? (
        <>
          <form
            className="flex flex-col gap-2 medium:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              connect(teamIdInput);
            }}
          >
            <Field
              label="FPL team ID or Points page URL"
              prefix="#"
              value={teamIdInput}
              onChange={setTeamIdInput}
              placeholder="1234567, or paste your Points page URL"
            />
            <Button variant="primary" type="submit" disabled={status === "loading"}>
              {status === "loading" ? "Connecting…" : "Connect"}
            </Button>
          </form>
          <p className="t-body m-0 text-text-muted">
            It is the number in the URL of your FPL <b>Points</b> page:{" "}
            <code className="t-data break-all rounded-xs bg-surface-2 px-1 py-0.5">
              fantasy.premierleague.com/entry/<b>1234567</b>/event/1
            </code>
          </p>
          {error && <p className="t-body m-0 text-negative">{error}</p>}
        </>
      ) : (
        <FindByName onPick={(entryId) => connect(String(entryId))} />
      )}

      <p className="t-caption m-0 text-text-muted">
        NINETY+ never asks for your FPL password. A team ID is public information and is stored
        only in this browser.
      </p>
    </Card>
  );
}
