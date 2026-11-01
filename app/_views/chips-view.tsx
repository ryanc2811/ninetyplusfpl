"use client";

import { useRouter } from "next/navigation";
import { useAppState } from "../_state/app-state";

/** The chip planner. A manager's locked choices are constraints, not suggestions. */
export function ChipsView() {
  const {
    applyChipStrategy,
    builderStarters,
    chipPlan,
    chipPlanValidation,
    gw1Strategy,
    projectedGw1,
    strategyMessage,
    template,
    templateEdge,
    updateChipChoice,
  } = useAppState();
  const router = useRouter();

  return (
      <div className="content strategy-grid">
        <article className="panel strategy-main">
          <div className="panel-head"><div><span className="eyebrow">MANAGER-CONTROLLED SEASON PLAN</span><h2>Chip strategy and squad route</h2></div><span className={chipPlanValidation.valid ? "valid-pill" : "invalid-pill"}>{chipPlanValidation.valid ? "✓ FPL rules valid" : chipPlanValidation.issues[0]}</span></div>
          <div className="strategy-hero">
            <span>GW1 SQUAD OBJECTIVE</span>
            <h3>{gw1Strategy === "bench-boost" ? "Maximise all 15 players" : gw1Strategy === "triple-captain" ? "Maximise premium captain ceiling" : "Maximise the starting XI"}</h3>
            <p>{gw1Strategy === "bench-boost" ? "GW1 bench projections receive full value while the starting squad is also assessed across GW2–3. The AI brings the first Wildcard route forward to protect your medium-term structure." : gw1Strategy === "triple-captain" ? "The captain receives an additional projection multiplier while the bench remains valued mainly for cover." : "The default draft prioritises the best legal XI and captain while retaining lower-weight bench cover."}</p>
            <div><b>Current GW1 projection</b><strong>{projectedGw1.toFixed(1)} pts</strong></div>
          </div>
          <div className="strategy-message">{strategyMessage}</div>
          {[1, 2].map((half) => (
            <section className="chip-half" key={half}>
              <div className="chip-half-head"><div><span className="eyebrow">CHIP SET {half}</span><h3>{half === 1 ? "GW1–19" : "GW20–38"}</h3></div><small>Use all four before this set expires</small></div>
              <div className="chip-options">
                {chipPlan.filter((item) => item.half === half).map((item) => (
                  <div className={item.locked ? "chip-option active" : "chip-option"} key={item.id}>
                    <span>{item.chip === "Triple Captain" ? "×3" : item.chip.slice(0, 2).toUpperCase()}</span>
                    <div><b>{item.chip}</b><small>{item.rationale}</small></div>
                    <label>
                      <span className="sr-only">Choose gameweek for {item.chip}</span>
                      <select value={item.locked ? String(item.gameweek) : "AI"} onChange={(event) => updateChipChoice(item.id, event.target.value)}>
                        <option value="AI">AI · GW{item.gameweek}</option>
                        {Array.from({ length: item.half === 1 ? 19 : 19 }, (_, index) => (item.half === 1 ? 1 : 20) + index)
                          .filter((gameweek) => !(gameweek === 1 && (item.chip === "Wildcard" || item.chip === "Free Hit")))
                          .map((gameweek) => <option value={gameweek} key={gameweek}>Lock GW{gameweek}</option>)}
                      </select>
                    </label>
                    <strong>{item.locked ? "YOU" : "AI"}</strong>
                  </div>
                ))}
              </div>
            </section>
          ))}
          <button className="primary-button strategy-apply" disabled={!chipPlanValidation.valid} onClick={applyChipStrategy}>Apply plan and rebuild GW1 squad <span>↗</span></button>
        </article>
        <aside className="builder-side">
          <article className="panel">
            <span className="eyebrow">CONNECTED DECISIONS</span><h2>What changes with your plan</h2>
            <div className="explain-stat"><span>GW1 optimisation</span><b>{gw1Strategy === "bench-boost" ? "All 15" : gw1Strategy === "triple-captain" ? "Captain ceiling" : "Best XI"}</b></div>
            <div className="explain-stat"><span>First Wildcard</span><b>GW{chipPlan.find((item) => item.id === "WC1")?.gameweek}</b></div>
            <div className="explain-stat"><span>Manager-locked chips</span><b>{chipPlan.filter((item) => item.locked).length} / 8</b></div>
            <button className="secondary-button wide" onClick={() => router.push("/squad")}>Review current squad</button>
          </article>
          <article className="panel">
            <span className="eyebrow">UNIQUE EDGE</span><h2>Regret-aware planning</h2>
            <p className="body-copy">Locked choices are treated as constraints, not ignored. Unlocked chips remain flexible and will be re-evaluated when fixture, availability and blank/double-gameweek forecasts improve.</p>
            <div className="explain-stat"><span>Plan status</span><b className="positive">{chipPlanValidation.valid ? "Rules valid" : "Needs attention"}</b></div><div className="explain-stat"><span>Future flexibility</span><b>{8 - chipPlan.filter((item) => item.locked).length} chips</b></div>
          </article>
          <article className="panel">
            <span className="eyebrow">TEMPLATE DIVERGENCE</span><h2>How different are you?</h2>
            {template ? (
              <>
                <p className="body-copy">The template XI is the highest-owned legal eleven in the game right now, captained by the most-owned outfield asset.</p>
                <div className="explain-stat"><span>Template projection</span><b>{template.points.toFixed(1)} pts</b></div>
                <div className="explain-stat"><span>Template captain</span><b>{template.captain.name}</b></div>
                <div className="explain-stat"><span>Your edge</span><b className={templateEdge !== null && templateEdge >= 0 ? "positive" : "negative"}>{templateEdge !== null ? `${templateEdge >= 0 ? "+" : ""}${templateEdge.toFixed(1)} pts` : "—"}</b></div>
                <div className="explain-stat"><span>Shared starters</span><b>{builderStarters.filter((player) => template.starters.some((asset) => asset.id === player.id)).length} / 11</b></div>
              </>
            ) : <p className="body-copy">Template comparison becomes available once the live player market has loaded.</p>}
          </article>
        </aside>
      </div>
  );
}
