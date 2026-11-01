"use client";

import { useRouter } from "next/navigation";
import { FORMATIONS, replacementError, type Formation } from "../../lib/squad-builder";
import { useAppState } from "../_state/app-state";

/** The squad builder. Every edit is checked against the FPL squad rules as it happens. */
export function SquadView() {
  const {
    applyLineupSwap,
    assignCaptain,
    assignViceCaptain,
    builderBench,
    builderCandidates,
    builderMessage,
    builderPitch,
    builderQuery,
    builderSquad,
    builderStarters,
    builderValidation,
    captainId,
    changeFormation,
    chooseReplacement,
    feedStatus,
    formation,
    gw1Strategy,
    legalBenchSwaps,
    live,
    moveBenchPlayer,
    optimised,
    optimising,
    projectedGw1,
    projectedGw3,
    promoteBenchPlayer,
    resetDraft,
    runOptimiser,
    selectBuilderSlot,
    selectedSlot,
    selectedSlotId,
    setBuilderQuery,
    setSelectedSlotId,
    starterIds,
    viceCaptainId,
  } = useAppState();
  const router = useRouter();

  return (
      <div className="content split-view">
        <article className="panel builder-panel">
          <div className="panel-head">
            <div><span className="eyebrow">RULES-AWARE BUILD</span><h2>Your editable squad</h2></div>
            <span className={builderValidation.valid ? "valid-pill" : "invalid-pill"}>{builderValidation.valid ? "✓ Valid squad" : `! ${builderValidation.issues[0]}`}</span>
          </div>
          <div className="budget-bar">
            <div><span>Spent</span><b>£{builderValidation.cost.toFixed(1)}m</b></div>
            <div><span>In bank</span><b className={100 - builderValidation.cost >= 0 ? "lime" : "negative"}>£{(100 - builderValidation.cost).toFixed(1)}m</b></div>
            <div><span>Club cap</span><b>{Math.max(...Object.values(builderValidation.clubs))} / 3 max</b></div>
            <div className="formation-control"><label htmlFor="formation">Formation</label><select id="formation" value={formation} onChange={(event) => changeFormation(event.target.value as Formation)}>{FORMATIONS.map((item) => <option value={item} key={item}>{item}</option>)}</select></div>
            <div><span>GW1 · {gw1Strategy === "bench-boost" ? "Bench Boost" : gw1Strategy === "triple-captain" ? "Triple Captain" : "captain"}</span><b>{projectedGw1.toFixed(1)} pts</b></div>
            <div><span>Starting XI · 3 GW</span><b>{projectedGw3.toFixed(1)} pts</b></div>
          </div>
          <div className="pitch builder-pitch">
            <div className="pitch-circle" />
            {builderPitch.map((player) => (
              <button className={selectedSlotId === player.id ? "pitch-player selected-player" : "pitch-player"} key={player.id} style={{ left: `${player.x}%`, top: `${player.y}%` }} onClick={() => selectBuilderSlot(player.id)} aria-label={`Select ${player.name}`}>
                <span className={`shirt ${player.position.toLowerCase()}`}>{captainId === player.id ? "C" : viceCaptainId === player.id ? "V" : player.team.slice(0, 1)}</span>
                <b>{player.name}</b><small>£{player.price.toFixed(1)} · {player.xp1.toFixed(1)} GW1 xPts</small>
              </button>
            ))}
          </div>
          <div className="bench-row roomy">
            <span>BENCH ORDER</span>
            {builderBench.map((player) => {
              const outfieldBench = builderBench.filter((asset) => asset.position !== "GK");
              const outfieldIndex = outfieldBench.findIndex((asset) => asset.id === player.id);
              return (
              <div className={selectedSlotId === player.id ? "bench-player selected" : "bench-player"} key={player.id}>
                <button className="bench-select" onClick={() => selectBuilderSlot(player.id)} aria-label={`Select ${player.name}`}><i>{player.position === "GK" ? "GK" : outfieldIndex + 1}</i><span><b>{player.name}</b><small>{player.position} · {player.xp1.toFixed(1)} GW1 xPts</small></span></button>
                <span className="bench-controls"><button className="start-button" onClick={() => promoteBenchPlayer(player.id)}>{selectedSlotId !== null && starterIds.includes(selectedSlotId) ? "Swap" : "Start"}</button><button disabled={player.position === "GK" || outfieldIndex === 0} onClick={() => moveBenchPlayer(player.id, -1)} aria-label={`Move ${player.name} earlier`}>←</button><button disabled={player.position === "GK" || outfieldIndex === outfieldBench.length - 1} onClick={() => moveBenchPlayer(player.id, 1)} aria-label={`Move ${player.name} later`}>→</button></span>
              </div>
              );
            })}
          </div>
          <p className="builder-hint"><span className={builderValidation.valid ? "live-dot" : "health-warn"} /> {builderMessage}</p>
        </article>
        <aside className="builder-side">
          <article className="panel player-picker">
            <div className="picker-head">
              <div><span className="eyebrow">PLAYER MARKET</span><h2>{selectedSlot ? `Replace ${selectedSlot.name}` : "Select a squad player"}</h2></div>
              {selectedSlot && <button className="plain-icon" onClick={() => setSelectedSlotId(null)} aria-label="Close player picker">×</button>}
            </div>
            {selectedSlot ? (
              <>
                <label className="picker-search"><span>⌕</span><input value={builderQuery} onChange={(event) => setBuilderQuery(event.target.value)} placeholder={`Search ${selectedSlot.position} players`} /></label>
                {builderStarters.some((player) => player.id === selectedSlot.id) && (
                  <div className="captain-actions">
                    <button className={captainId === selectedSlot.id ? "active" : ""} onClick={() => assignCaptain(selectedSlot.id)}>Captain</button>
                    <button className={viceCaptainId === selectedSlot.id ? "active" : ""} onClick={() => assignViceCaptain(selectedSlot.id)}>Vice captain</button>
                  </div>
                )}
                {legalBenchSwaps.length > 0 && (
                  <div className="lineup-swap-list">
                    <span>SWAP WITH BENCH</span>
                    {legalBenchSwaps.map((player) => (
                      <button key={player.id} onClick={() => applyLineupSwap(selectedSlot.id, player.id)}>
                        <b>{player.name}</b><small>{player.position} · {player.xp1.toFixed(1)} GW1 xPts</small><i>↥</i>
                      </button>
                    ))}
                  </div>
                )}
                {!starterIds.includes(selectedSlot.id) && (
                  <button className="secondary-button wide promote-button" onClick={() => promoteBenchPlayer(selectedSlot.id)}>Move to starting XI</button>
                )}
                <div className="candidate-list">
                  {builderCandidates.map((candidate) => {
                    const error = replacementError(builderSquad, selectedSlot.id, candidate);
                    return (
                      <button key={candidate.id} disabled={Boolean(error)} onClick={() => chooseReplacement(candidate)} title={error ?? `Replace with ${candidate.name}`}>
                        <span className="candidate-badge">{candidate.team}</span>
                        <span><b>{candidate.name}</b><small>{candidate.position} · {candidate.xp3.toFixed(1)} three-GW xPts</small></span>
                        <em>£{candidate.price.toFixed(1)}</em>
                        <i>{error ? "—" : "＋"}</i>
                      </button>
                    );
                  })}
                  {!builderCandidates.length && <div className="picker-empty">{feedStatus === "loading" ? "Loading the live player market…" : "No eligible players match this search."}</div>}
                </div>
              </>
            ) : <div className="picker-prompt"><span>↖</span><b>Choose any shirt or bench player</b><p>The market will show eligible replacements at the same position.</p></div>}
          </article>
          <article className="panel constraint-card">
            <span className="eyebrow">XI OPTIMISER</span><h2>Use the highest-projected XI</h2>
            <p className="body-copy">Checks every valid formation using the same GW1 xPts shown in Player Lab, then assigns captain and vice-captain. It does not change your 15-player squad.</p>
            <button className="primary-button wide" onClick={runOptimiser}>{optimising ? "Checking formations…" : optimised ? "XI optimised ✓" : "Optimise XI & captain"}</button>
            <button className="secondary-button reset-button" onClick={resetDraft}>Rebuild for {gw1Strategy === "bench-boost" ? "GW1 Bench Boost + GW2–3" : gw1Strategy === "triple-captain" ? "GW1 Triple Captain" : "live GW1"}</button>
            <button className="text-button strategy-link" onClick={() => router.push("/chips")}>Change chip strategy →</button>
          </article>
          <article className="panel why-card"><span className="eyebrow">FPL RULES</span><h2>Live validation</h2>{builderValidation.issues.length ? builderValidation.issues.map((issue) => <p className="rule-error" key={issue}>! {issue}</p>) : <p>2 goalkeepers · 5 defenders · 5 midfielders · 3 forwards. Budget and three-per-club limits are satisfied.</p>}<div className="explain-stat"><span>Squad size</span><b>{builderSquad.length} / 15</b></div><div className="explain-stat"><span>Data source</span><b className={live ? "positive" : ""}>{live ? "Live" : "Preview"}</b></div></article>
        </aside>
      </div>
  );
}
