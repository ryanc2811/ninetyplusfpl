"use client";

import { Fragment } from "react";
import { BREAKDOWN_LABELS, useAppState } from "../_state/app-state";

/** The player lab: the ranking, and the evidence behind each projection. */
export function PlayersView() {
  const {
    backtest,
    eventModelVersion,
    expectedMinutesVersion,
    feedStatus,
    live,
    modelVersion,
    pointsModelVersion,
    position,
    query,
    range,
    selectedPlayerId,
    setPosition,
    setQuery,
    setRange,
    setSelectedPlayerId,
    setVisibleCount,
    shownPlayers,
    simulationCount,
    teamLineupAdjustedCount,
    teamModelVersion,
    teamOpportunityAdjustedCount,
    updatedAt,
    visibleCount,
  } = useAppState();

  return (
      <div className="content">
        <div className="lab-toolbar">
          <label className="search"><span>⌕</span><input value={query} onChange={(e) => { setQuery(e.target.value); setVisibleCount(40); }} placeholder="Search player" /></label>
          <div className="segmented">
            {(["ALL", "GK", "DEF", "MID", "FWD"] as const).map((item) => <button key={item} className={position === item ? "selected" : ""} onClick={() => { setPosition(item); setVisibleCount(40); }}>{item}</button>)}
          </div>
          <div className="segmented"><button className={range === 1 ? "selected" : ""} onClick={() => { setRange(1); setVisibleCount(40); }}>1 GW</button><button className={range === 3 ? "selected" : ""} onClick={() => { setRange(3); setVisibleCount(40); }}>3 GW</button></div>
        </div>
        <article className="panel player-table-wrap">
          <div className="table-summary">
            <div><span className="eyebrow">{pointsModelVersion ? "PROBABILISTIC POINTS RANKING" : "BASELINE POINTS RANKING"} · {modelVersion.toUpperCase()}</span><h2>{shownPlayers.length} players modelled <em className="baseline-pill">{pointsModelVersion ? `${simulationCount?.toLocaleString() ?? ""} Monte Carlo paths` : expectedMinutesVersion === "expected-minutes-team-lineup-v1" ? "Correlated team-lineup xMins" : expectedMinutesVersion === "expected-minutes-team-opportunity-v1" ? "Team-opportunity xMins" : expectedMinutesVersion.includes("-v2-") ? "Experimental trained xMins" : "Expected-minutes baseline"}</em></h2></div>
            <div className="data-health"><span><i className={live ? "health-good" : "health-warn"} /> {feedStatus === "loading" ? "Connecting official feed…" : live ? "Official feed connected" : "Preview fallback active"}</span><span>{expectedMinutesVersion === "expected-minutes-team-lineup-v1" ? `${teamLineupAdjustedCount} players lineup-constrained${teamOpportunityAdjustedCount ? ` · ${teamOpportunityAdjustedCount} injury boosts` : ""}` : expectedMinutesVersion === "expected-minutes-team-opportunity-v1" ? `${teamOpportunityAdjustedCount} injury-opportunity adjustments` : expectedMinutesVersion.includes("-v2-") ? "Expected-minutes v2" : "Expected-minutes v1"}</span><span>{teamModelVersion ? "Poisson team model" : "FPL fixture baseline"}</span>{pointsModelVersion && <span>2026/27 rules · bonus + DC</span>}{eventModelVersion && <span>Trained player-event priors</span>}{backtest && <span title={`${backtest.foldCount} expanding-window folds · ${backtest.sampleCount} locked forecasts`}>Backtest MAE {backtest.modelMinutesMae.toFixed(1)} vs {backtest.baselineMinutesMae.toFixed(1)} baseline</span>}</div>
          </div>
          <div className="player-table">
            <div className="player-row table-head"><span>Rank / player</span><span>Fixture</span><span>Price</span><span>{range} GW xPts</span><span>Form</span><span>xMins</span><span>Own.</span><span>Confidence</span></div>
            {feedStatus === "loading" && Array.from({ length: 8 }, (_, index) => (
              <div className="skeleton-row" key={`skeleton-${index}`} aria-hidden="true">
                <span className="skeleton" style={{ width: 22 }} />
                <span className="skeleton" style={{ width: 150 }} />
                <span className="skeleton" style={{ width: 60 }} />
                <span className="skeleton" style={{ width: 44 }} />
                <span className="skeleton" style={{ width: 52 }} />
                <span className="skeleton" style={{ width: 40 }} />
                <span className="skeleton" style={{ width: 46 }} />
              </div>
            ))}
            {feedStatus !== "loading" && shownPlayers.slice(0, visibleCount).map((player, index) => (
              <Fragment key={player.id}>
                <button className="player-row" title={player.fixtures?.length ? `Next fixtures: ${player.fixtures.join(" · ")}` : undefined} onClick={() => setSelectedPlayerId((current) => current === player.id ? null : player.id)} aria-expanded={selectedPlayerId === player.id}>
                  <span className="player-identity"><i>{index + 1}</i><b>{player.name}<small>{player.team} · {player.position}</small></b>{player.tag && <em>{player.tag}</em>}</span>
                  <span className="fixture-cell"><b>{player.opponent}</b><small>{player.venue}</small></span>
                  <span>£{player.price.toFixed(1)}</span>
                  <span className="xp-cell">{(range === 1 ? player.xp1 : player.xp3).toFixed(1)}</span>
                  <span>{player.form.toFixed(1)}</span>
                  <span>{(player.expectedMinutes?.expectedMinutes ?? player.minutes).toFixed(1)}</span>
                  <span>{player.ownership.toFixed(1)}%</span>
                  <span className="confidence-cell"><i style={{ width: `${player.confidence ?? 58}%` }} /><b>{player.confidence ?? 58}%</b></span>
                </button>
                {selectedPlayerId === player.id && (
                  <div className="player-explanation">
                    <div className="explanation-title"><div><span className="eyebrow">WHY THIS FORECAST?</span><h3>{player.name} · minutes, events and uncertainty</h3></div><span className="model-label">{player.pointsDistribution ? "Monte Carlo v1 · 2026/27 rules" : player.expectedMinutes?.modelVersion === "expected-minutes-team-lineup-v1" ? "Correlated team-lineup minutes v1" : player.expectedMinutes?.modelVersion === "expected-minutes-team-opportunity-v1" ? "Team-opportunity minutes v1" : player.expectedMinutes?.modelVersion === "expected-minutes-v2-linear-1" ? "Expected-minutes v2 · experimental" : "Expected-minutes baseline v1"}</span></div>
                    {player.expectedMinutes ? (
                      <>
                        <div className="probability-grid">
                          <div><span>Start</span><b>{player.expectedMinutes.startProbability}%</b></div>
                          <div><span>Sub appearance</span><b>{player.expectedMinutes.substituteProbability}%</b></div>
                          <div><span>Zero minutes</span><b>{player.expectedMinutes.zeroMinutesProbability}%</b></div>
                          <div><span>Reach 60</span><b>{player.expectedMinutes.sixtyMinuteProbability}%</b></div>
                          <div><span>Expected minutes</span><b>{player.expectedMinutes.expectedMinutes}</b></div>
                          {player.teamExpectedGoals !== undefined && <div><span>Team expected goals</span><b>{player.teamExpectedGoals.toFixed(2)}</b></div>}
                          {player.cleanSheetProbability !== undefined && <div><span>Clean-sheet chance</span><b>{Math.round(player.cleanSheetProbability * 100)}%</b></div>}
                          {player.pointsDistribution && <><div><span>Floor · median · ceiling</span><b>{player.pointsDistribution.p10Points.toFixed(0)} · {player.pointsDistribution.medianPoints.toFixed(0)} · {player.pointsDistribution.p90Points.toFixed(0)}</b></div><div><span>5+ / 10+ points</span><b>{Math.round(player.pointsDistribution.fivePlusProbability * 100)}% / {Math.round(player.pointsDistribution.tenPlusProbability * 100)}%</b></div><div><span>Goal / assist</span><b>{Math.round(player.pointsDistribution.goalProbability * 100)}% / {Math.round(player.pointsDistribution.assistProbability * 100)}%</b></div><div><span>Bonus potential</span><b>{Math.round(player.pointsDistribution.bonusProbability * 100)}%</b></div><div><span>Defensive contribution</span><b>{Math.round(player.pointsDistribution.defensiveContributionProbability * 100)}%</b></div></>}
                        </div>
                        {player.pointsBreakdown && (
                          <div className="breakdown-block">
                            <span className="eyebrow">WHERE THE POINTS COME FROM</span>
                            <div className="breakdown-bar">
                              {BREAKDOWN_LABELS.filter(([key]) => player.pointsBreakdown![key] > 0).map(([key, label]) => (
                                <i
                                  key={key}
                                  className={`seg-${key}`}
                                  style={{ width: `${(player.pointsBreakdown![key] / Math.max(0.01, player.pointsBreakdown!.total)) * 100}%` }}
                                  title={`${label}: ${player.pointsBreakdown![key].toFixed(2)} pts`}
                                />
                              ))}
                            </div>
                            <div className="breakdown-list">
                              {BREAKDOWN_LABELS.filter(([key]) => Math.abs(player.pointsBreakdown![key]) >= 0.01).map(([key, label]) => (
                                <div key={key}>
                                  <span>{label}</span>
                                  <b className={player.pointsBreakdown![key] < 0 ? "negative" : undefined}>
                                    {player.pointsBreakdown![key] > 0 ? "+" : ""}{player.pointsBreakdown![key].toFixed(2)}
                                  </b>
                                </div>
                              ))}
                              <div className="breakdown-total"><span>Projected</span><b>{player.pointsBreakdown.total.toFixed(2)}</b></div>
                            </div>
                            {player.rates && (
                              <p className="model-note">
                                Built from {player.rates.expectedGoals.toFixed(2)} xG and {player.rates.expectedAssists.toFixed(2)} xA per 90
                                {player.rates.defensiveActions > 0 ? `, ${player.rates.defensiveActions.toFixed(1)} defensive actions per 90` : ""}
                                {" · "}{Math.round(player.rates.observationWeight * 100)}% observed, {Math.round((1 - player.rates.observationWeight) * 100)}% position prior
                              </p>
                            )}
                          </div>
                        )}
                        <div className="evidence-grid">
                          <div><span className="eyebrow">STRUCTURED EVIDENCE</span>{(player.pointsDistribution?.reasons ?? player.expectedMinutes.reasons).map((reason) => <p key={reason}>✓ {reason}</p>)}</div>
                          <div><span className="eyebrow">NEXT FIXTURES</span><p>{player.fixtures?.join(" · ") || "Fixture data pending"}</p><p>Minutes confidence: {player.expectedMinutes.confidence}%</p></div>
                          <div><span className="eyebrow">PROVENANCE</span><p>Official FPL public data</p><p>{updatedAt ? `Retrieved ${new Date(updatedAt).toLocaleString()}` : "Preview evidence only"}</p></div>
                        </div>
                      </>
                    ) : <p className="fallback-note">Live expected-minutes evidence is unavailable. This row is using the clearly labelled preview fallback.</p>}
                  </div>
                )}
              </Fragment>
            ))}
          </div>
          {shownPlayers.length === 0 && <div className="empty-state"><b>No players match those filters</b><span>Clear the search or select another position.</span></div>}
          {visibleCount < shownPlayers.length && <button className="load-more" onClick={() => setVisibleCount((count) => count + 40)}>Show 40 more <span>{shownPlayers.length - visibleCount} remaining</span></button>}
        </article>
      </div>
  );
}
