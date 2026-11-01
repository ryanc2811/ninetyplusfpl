"use client";

import { useRouter } from "next/navigation";
import { useAppState } from "../_state/app-state";

/** The decision room: what the model thinks, and the one move it would make next. */
export function OverviewView() {
  const {
    animatedGw1,
    animatedGw3,
    animatedSquadValue,
    builderBench,
    builderPitch,
    builderValidation,
    captain,
    captainEdge,
    captainId,
    chipPlan,
    nextEvent,
    nextPlannedChip,
    projectionLeaders,
    selectBuilderSlot,
    setRange,
    squadCapture,
    teamOutlook,
    templateEdge,
    transferSuggestion,
    viceCaptainId,
  } = useAppState();
  const router = useRouter();

  return (
      <div className="content">
        <section className="signal-strip">
          <div><span className="live-dot" /> MODEL SIGNAL</div>
          <p><b>Live squad state is synchronised.</b> Decision Room, Squad Builder and Player Lab now use the same projection output; optimise again whenever the feed changes.</p>
          <button onClick={() => router.push("/squad")}>Review XI →</button>
        </section>

        <div className="metric-grid">
          <article className="metric hero-metric">
            <span>PROJECTED GW{nextEvent}</span>
            <div className="metric-value">{animatedGw1} <small>pts</small></div>
            <div className="meter"><i style={{ width: `${squadCapture}%` }} /></div>
            <footer><b>{squadCapture}% of squad</b><span>starting XI share</span></footer>
          </article>
          <article className="metric">
            <span>3-GW OUTLOOK</span>
            <div className="metric-value">{animatedGw3} <small>pts</small></div>
            <footer className={templateEdge !== null && templateEdge >= 0 ? "positive" : undefined}>
              {templateEdge === null
                ? "Template comparison pending"
                : `${templateEdge >= 0 ? "↑" : "↓"} ${Math.abs(templateEdge).toFixed(1)} vs template XI`}
            </footer>
          </article>
          <article className="metric">
            <span>SQUAD VALUE</span>
            <div className="metric-value">£{animatedSquadValue}<span className="bank">+ £{(100 - builderValidation.cost).toFixed(1)} ITB</span></div>
            <footer>15 / 15 · Rules valid</footer>
          </article>
          <article className="metric">
            <span>CAPTAIN EDGE</span>
            <div className="captain-row"><div className="mini-shirt">C</div><div><b>{captain?.name ?? "No captain"}</b><small>{captain?.xp1.toFixed(1) ?? "0.0"} GW1 xPts</small></div><em>+{captainEdge.toFixed(1)}</em></div>
            <footer>vs next-best captain</footer>
          </article>
        </div>

        <div className="dashboard-grid">
          <article className="panel squad-panel">
            <div className="panel-head">
              <div><span className="eyebrow">OPTIMAL XI</span><h2>Squad intelligence</h2></div>
              <button className="text-button" onClick={() => router.push("/squad")}>Edit squad →</button>
            </div>
            <div className="pitch">
              <div className="pitch-circle" />
              {builderPitch.map((player) => (
                <button className="pitch-player" key={player.id} style={{ left: `${player.x}%`, top: `${player.y}%` }} title={`${player.name} · ${player.xp1.toFixed(1)} GW1 xPts`} onClick={() => { router.push("/squad"); selectBuilderSlot(player.id); }}>
                  <span className={`shirt ${player.position.toLowerCase()}`}>{captainId === player.id ? "C" : viceCaptainId === player.id ? "V" : player.team.slice(0, 1)}</span>
                  <b>{player.name}</b><small>{player.xp1.toFixed(1)} GW1 xPts</small>
                </button>
              ))}
            </div>
            <div className="bench-row">
              <span>BENCH</span>
              {builderBench.map((player) => <div key={player.id}><i>{player.position}</i><b>{player.name}</b><small>{player.xp1.toFixed(1)} xPts</small></div>)}
            </div>
          </article>

          <div className="right-stack">
            <article className="panel transfer-panel">
              <div className="panel-head"><div><span className="eyebrow">NEXT BEST MOVE</span><h2>Transfer radar</h2></div><span className="confidence">Rules checked</span></div>
              {transferSuggestion ? (
                <>
                  <div className="transfer-swap">
                    <div><span className="player-orb out">{transferSuggestion.outgoing.team}</span><b>{transferSuggestion.outgoing.name}</b><small>£{transferSuggestion.outgoing.price.toFixed(1)}m · {transferSuggestion.outgoing.xp3.toFixed(1)} xPts</small></div>
                    <span className="swap-arrow">→</span>
                    <div><span className="player-orb in">{transferSuggestion.incoming.team}</span><b>{transferSuggestion.incoming.name}</b><small>£{transferSuggestion.incoming.price.toFixed(1)}m · {transferSuggestion.incoming.xp3.toFixed(1)} xPts</small></div>
                  </div>
                  <div className="transfer-gain"><span>3-GW expected gain</span><strong>+{transferSuggestion.gain.toFixed(1)} pts</strong></div>
                  <p>This is the highest projected legal same-position replacement under the current budget and three-player club limit.</p>
                </>
              ) : <p>No legal positive-projection transfer is currently available.</p>}
              <button className="secondary-button" onClick={() => router.push("/squad")}>Open squad builder</button>
            </article>

            <article className="panel market-panel">
              <div className="panel-head"><div><span className="eyebrow">MODEL LEADERS</span><h2>GW1 projection leaders</h2></div><button className="text-button" onClick={() => { setRange(1); router.push("/players"); }}>Player Lab →</button></div>
              {projectionLeaders.map((player) => (
                <div className="market-row" key={player.id}>
                  <span className="initial">{player.name.slice(0, 2).toUpperCase()}</span>
                  <div><b>{player.name}</b><small>{player.team} · {player.position}</small></div>
                  <div className="pressure"><i style={{ width: `${Math.min(100, (player.xp1 / Math.max(projectionLeaders[0]?.xp1 ?? 1, 1)) * 100)}%` }} /></div>
                  <em>{player.xp1.toFixed(1)} xPts</em>
                </div>
              ))}
            </article>
          </div>
        </div>

        <div className="lower-grid">
          <article className="panel">
            <div className="panel-head"><div><span className="eyebrow">FIXTURE MODEL</span><h2>Three-week run</h2></div><span className="subtle">Expected goals</span></div>
            {teamOutlook.slice(0, 5).map((row) => (
              <div className="fixture-row" key={row.team}>
                <b>{row.team}</b>
                <span>{row.attackScore >= row.defenceScore + 15 ? "Attack" : row.defenceScore >= row.attackScore + 15 ? "Defence" : "Attack + defence"}</span>
                <div className="fixtures">
                  {row.fixtures.map((fixture, index) => (
                    <i
                      key={`${fixture.opponent}-${index}`}
                      className={fixture.difficulty <= 2 ? "easy" : fixture.difficulty === 3 ? "medium" : "hard"}
                      title={`${fixture.opponent} (${fixture.venue}) · ${fixture.expectedGoalsFor} xGF, ${fixture.expectedGoalsAgainst} xGA`}
                    >
                      {fixture.opponent}{fixture.venue === "A" ? " ↗" : ""}
                    </i>
                  ))}
                </div>
                <div className="fixture-score"><strong>{row.overallScore}</strong><small>/ 100</small></div>
              </div>
            ))}
            {!teamOutlook.length && <div className="picker-empty">Fixture model loading…</div>}
          </article>
          <article className="panel">
            <div className="panel-head"><div><span className="eyebrow">CHIP FORECAST</span><h2>Season leverage</h2></div><button className="text-button" onClick={() => router.push("/chips")}>Plan all →</button></div>
            <div className="chip-call">
              <div className="chip-icon">{nextPlannedChip?.chip === "Triple Captain" ? "×3" : nextPlannedChip?.chip.slice(0, 2).toUpperCase()}</div>
              <div><b>{nextPlannedChip?.chip} · GW{nextPlannedChip?.gameweek}</b><p>{nextPlannedChip?.rationale}</p></div>
              <strong>{nextPlannedChip?.locked ? "LOCKED" : "AI"}</strong>
            </div>
            <div className="chip-timeline">{chipPlan.filter((item) => item.half === 1).sort((a, b) => a.gameweek - b.gameweek).map((item) => <span className={item.locked ? "used" : "target"} key={item.id}>{item.gameweek}<i>{item.id.slice(0, 2)}</i></span>)}</div>
            <p className="model-note">Manager-locked choices reshape the remaining chip route and the relevant squad-building objective.</p>
          </article>
        </div>
      </div>
  );
}
