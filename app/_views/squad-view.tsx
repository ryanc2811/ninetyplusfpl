"use client";

import { useState } from "react";
import { FORMATIONS, replacementError, type Formation, type SquadAsset } from "../../lib/squad-builder";
import { Pitch, type PitchPlayer } from "../_components/squad/pitch";
import { flaggedPlayers } from "../_components/squad/projection";
import {
  BottomSheet,
  Button,
  Card,
  CardHead,
  Chip,
  EmptyState,
  Icon,
  PlayerRow,
  SegmentedControl,
} from "../_components/ui";
import { useAppState } from "../_state/app-state";

function Figure({ label, value, tone }: { label: string; value: string; tone?: "negative" }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2">
      <span className="t-caption text-text-muted">{label}</span>
      <span className={tone === "negative" ? "t-data-lg text-negative" : "t-data-lg"}>{value}</span>
    </div>
  );
}

/** The squad builder. Every edit is checked against the FPL squad rules as it happens. */
export function SquadView() {
  const {
    builderSquad,
    builderStarters,
    builderBench,
    builderValidation,
    builderCandidates,
    builderQuery,
    setBuilderQuery,
    builderMessage,
    budget,
    bankRemaining,
    captainId,
    viceCaptainId,
    selectedSlotId,
    setSelectedSlotId,
    selectedSlot,
    starterIds,
    formation,
    changeFormation,
    selectBuilderSlot,
    chooseReplacement,
    promoteBenchPlayer,
    moveBenchPlayer,
    assignCaptain,
    assignViceCaptain,
    runOptimiser,
    resetDraft,
    optimising,
    optimised,
    projectedGw1,
    gw1Strategy,
    players,
    squadSource,
    squadImportError,
    nextEvent,
    feedStatus,
  } = useAppState();

  const [view, setView] = useState<"pitch" | "list">("pitch");
  const [replacing, setReplacing] = useState(false);

  const flagged = new Map(flaggedPlayers(builderSquad, players).map((row) => [row.name, row]));
  const pitchPlayers: PitchPlayer[] = builderStarters.map((player) => ({
    ...player,
    captain: player.id === captainId,
    viceCaptain: player.id === viceCaptainId,
    flagged: flagged.has(player.name),
  }));

  const selectedIsStarter = selectedSlot ? starterIds.includes(selectedSlot.id) : false;
  const outfieldBench = builderBench.filter((player) => player.position !== "GK");
  const benchOrderIndex = selectedSlot
    ? outfieldBench.findIndex((player) => player.id === selectedSlot.id)
    : -1;

  const openReplace = () => {
    setBuilderQuery("");
    setReplacing(true);
  };

  function pick(candidate: SquadAsset) {
    chooseReplacement(candidate);
    setReplacing(false);
  }

  return (
    <div className="flex flex-col gap-3 pb-20 medium:gap-4 expanded:pb-0">
      <div className="flex flex-col gap-2 medium:flex-row medium:items-center medium:justify-between">
        <SegmentedControl
          className="medium:w-[220px]"
          label="Squad view"
          value={view}
          onChange={setView}
          options={[
            { value: "pitch", label: "Pitch" },
            { value: "list", label: "List" },
          ]}
        />
        <span className="self-start">
          <Chip tone={builderValidation.valid ? "positive" : "negative"}>
            {builderValidation.valid ? "Valid squad" : builderValidation.issues[0]}
          </Chip>
        </span>
      </div>

      <div className="grid grid-cols-2 divide-border overflow-hidden rounded-md border border-border bg-surface medium:grid-cols-4">
        <Figure label={`GW ${nextEvent} xP`} value={projectedGw1.toFixed(1)} />
        <Figure
          label="Bank"
          value={`£${bankRemaining.toFixed(1)}m`}
          tone={bankRemaining < 0 ? "negative" : undefined}
        />
        <Figure label="Squad value" value={`£${builderValidation.cost.toFixed(1)}m`} />
        <label className="flex flex-col gap-0.5 px-3 py-2">
          <span className="t-caption text-text-muted">Formation</span>
          <select
            value={formation}
            onChange={(event) => changeFormation(event.target.value as Formation)}
            className="t-data-lg min-h-8 border-0 bg-transparent text-text outline-none"
          >
            {FORMATIONS.map((shape) => (
              <option key={shape} value={shape}>
                {shape}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-3 expanded:grid expanded:grid-cols-[minmax(0,1.35fr)_minmax(300px,1fr)] expanded:items-start expanded:gap-4">
      {view === "pitch" ? (
        <Pitch players={pitchPlayers} selectedId={selectedSlotId} onSelect={selectBuilderSlot} />
      ) : (
        <Card padded={false}>
          {builderStarters.map((player) => (
            <PlayerRow
              key={player.id}
              selected={player.id === selectedSlotId}
              onClick={() => selectBuilderSlot(player.id)}
              lead={<span className="t-caption font-mono text-text-muted">{player.position}</span>}
              title={
                <>
                  {player.name}
                  {player.id === captainId && <Chip tone="accent">C</Chip>}
                  {player.id === viceCaptainId && <Chip tone="neutral">V</Chip>}
                </>
              }
              meta={`${player.team} · £${player.price.toFixed(1)}m`}
              figure={player.xp1.toFixed(1)}
              figureNote="xP"
            />
          ))}
        </Card>
      )}

      <div className="flex flex-col gap-3 expanded:gap-4">
      <Card padded={false}>
        <div className="t-eyebrow flex items-center justify-between bg-surface-2 px-3 py-2 text-text-muted">
          <span>Bench</span>
          <span>In order</span>
        </div>
        {builderBench.map((player) => {
          const outfield = builderBench.filter((asset) => asset.position !== "GK");
          const outfieldIndex = outfield.findIndex((asset) => asset.id === player.id);
          return (
            <PlayerRow
              key={player.id}
              selected={player.id === selectedSlotId}
              onClick={() => selectBuilderSlot(player.id)}
              lead={
                <span className="t-caption grid h-7 w-7 place-items-center rounded-full bg-surface-3 font-mono">
                  {player.position === "GK" ? "GK" : outfieldIndex + 1}
                </span>
              }
              title={player.name}
              meta={`${player.team} · ${player.position} · £${player.price.toFixed(1)}m`}
              figure={player.xp1.toFixed(1)}
              figureNote="xP"
            />
          );
        })}
      </Card>

      <Card className="flex flex-col gap-3">
        <CardHead
          eyebrow="Rules-aware build"
          title={squadSource === "fpl" ? "Your FPL squad" : "Model draft"}
        />
        <p className="t-body m-0 text-text-muted">{builderMessage}</p>
        {squadImportError && <p className="t-body m-0 text-negative">{squadImportError}</p>}
        {!builderValidation.valid && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {builderValidation.issues.map((issue) => (
              <li key={issue} className="t-body text-negative">
                {issue}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2 medium:flex-row">
          <Button onClick={runOptimiser} className="medium:flex-1">
            {optimising ? "Checking formations…" : optimised ? "XI optimised" : "Optimise XI and captain"}
          </Button>
          <Button onClick={resetDraft} className="medium:flex-1">
            {`Rebuild for ${gw1Strategy === "bench-boost" ? "Bench Boost" : gw1Strategy === "triple-captain" ? "Triple Captain" : "a fresh £100.0m draft"}`}
          </Button>
        </div>
      </Card>

      </div>
      </div>

      {/* The screen's primary action sits in the thumb zone while a player is selected. */}
      {selectedSlot && (
        <div className="fixed inset-x-0 bottom-[calc(var(--tab-bar)+env(safe-area-inset-bottom))] z-[var(--z-tabbar)] border-t border-border bg-header-glass p-3 backdrop-blur-md expanded:static expanded:rounded-md expanded:border expanded:p-4">
          <div className="mx-auto flex w-full max-w-[var(--content-max)] flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="t-headline truncate">{selectedSlot.name}</span>
              <button
                type="button"
                onClick={() => setSelectedSlotId(null)}
                className="t-label np-press min-h-[var(--tap-min)] px-2 text-positive"
              >
                Clear
              </button>
            </div>
            {selectedIsStarter ? (
              <div className="grid grid-cols-3 gap-2">
                <Button
                  onClick={() => assignCaptain(selectedSlot.id)}
                  disabled={selectedSlot.id === captainId}
                >
                  Captain
                </Button>
                <Button
                  onClick={() => assignViceCaptain(selectedSlot.id)}
                  disabled={selectedSlot.id === viceCaptainId}
                >
                  Vice
                </Button>
                <Button variant="primary" onClick={openReplace}>
                  Replace
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <Button onClick={() => promoteBenchPlayer(selectedSlot.id)}>Start</Button>
                <span className="flex gap-2">
                  <Button
                    aria-label={`Move ${selectedSlot.name} earlier on the bench`}
                    onClick={() => moveBenchPlayer(selectedSlot.id, -1)}
                    disabled={selectedSlot.position === "GK" || benchOrderIndex === 0}
                    className="flex-1 px-0"
                  >
                    <Icon name="chevronLeft" />
                  </Button>
                  <Button
                    aria-label={`Move ${selectedSlot.name} later on the bench`}
                    onClick={() => moveBenchPlayer(selectedSlot.id, 1)}
                    disabled={selectedSlot.position === "GK" || benchOrderIndex === outfieldBench.length - 1}
                    className="flex-1 px-0"
                  >
                    <Icon name="chevronRight" />
                  </Button>
                </span>
                <Button variant="primary" onClick={openReplace}>
                  Replace
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <BottomSheet
        open={replacing && Boolean(selectedSlot)}
        onClose={() => setReplacing(false)}
        label={`Replace ${selectedSlot?.name ?? "player"}`}
        header={
          <>
            <span className="t-eyebrow text-text-muted">Player market</span>
            <span className="t-title-2">Replace {selectedSlot?.name}</span>
            <span className="t-body-sm text-text-muted">
              {selectedSlot?.position} · up to £
              {(bankRemaining + (selectedSlot?.price ?? 0)).toFixed(1)}m
            </span>
          </>
        }
      >
        <label className="flex min-h-[var(--control-md)] items-center gap-2 rounded-sm border border-border-strong bg-surface px-3">
          <Icon name="search" className="text-text-muted" />
          <input
            value={builderQuery}
            onChange={(event) => setBuilderQuery(event.target.value)}
            placeholder={`Search ${selectedSlot?.position ?? ""} players`}
            aria-label="Search players"
            className="t-input w-full border-0 bg-transparent text-text outline-none placeholder:text-text-disabled"
          />
        </label>
        <div className="flex flex-col">
          {builderCandidates.map((candidate) => {
            const error = selectedSlot
              ? replacementError(builderSquad, selectedSlot.id, candidate, budget)
              : "Select a player first";
            return (
              <PlayerRow
                key={candidate.id}
                onClick={error ? undefined : () => pick(candidate)}
                className={error ? "opacity-45" : undefined}
                lead={<span className="t-caption font-mono text-text-muted">{candidate.position}</span>}
                title={candidate.name}
                meta={error ?? `${candidate.team} · £${candidate.price.toFixed(1)}m`}
                figure={candidate.xp3.toFixed(1)}
                figureNote="3 GW"
              />
            );
          })}
          {!builderCandidates.length && (
            <EmptyState icon="search" title="No eligible players">
              {feedStatus === "loading"
                ? "The live player market is still loading."
                : "Clear the search or pick a different position."}
            </EmptyState>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
