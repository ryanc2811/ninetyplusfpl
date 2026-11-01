"use client";

import { BADGE_ICONS, useAppState } from "../_state/app-state";

/** Leagues: monthly awards and manager insight for the people you actually play against. */
export function LeaguesView() {
  const {
    connectError,
    connectStatus,
    connectTeam,
    currentMonth,
    disconnectTeam,
    leagueInsights,
    leagueStatus,
    manager,
    managerLeagues,
    monthlyBadges,
    openLeague,
    seasonBadges,
    selectedLeagueId,
    setTeamIdInput,
    teamIdInput,
  } = useAppState();

  return (
      <div className="content">
        {!manager ? (
          <article className="panel connect-panel">
            <span className="eyebrow">CONNECT YOUR SQUAD</span>
            <h2>Link your real FPL mini-leagues</h2>
            <p className="body-copy">
              Enter your FPL team ID to pull in your classic leagues and see monthly awards,
              bench regret and hit tax across the managers you actually play against.
              Find it in the URL of your FPL <b>Points</b> page:
              {" "}<code>fantasy.premierleague.com/entry/<b>1234567</b>/event/1</code>.
            </p>
            <form
              className="connect-form"
              onSubmit={(event) => { event.preventDefault(); void connectTeam(teamIdInput); }}
            >
              <label className="picker-search">
                <span>#</span>
                <input
                  value={teamIdInput}
                  onChange={(event) => setTeamIdInput(event.target.value)}
                  placeholder="Your FPL team ID, e.g. 1234567"
                  inputMode="numeric"
                  aria-label="FPL team ID"
                />
              </label>
              <button className="primary-button" type="submit" disabled={connectStatus === "loading"}>
                {connectStatus === "loading" ? "Connecting…" : "Connect"} <span>↗</span>
              </button>
            </form>
            {connectError && <p className="rule-error">! {connectError}</p>}
            <p className="model-note">
              NINETY+ never asks for your FPL password. A team ID is public information and is
              stored only in this browser.
            </p>
          </article>
        ) : (
          <>
            <section className="signal-strip league-strip">
              <div><span className="live-dot" /> CONNECTED</div>
              <p>
                <b>{manager.teamName}</b> · {manager.managerName}
                {manager.overallPoints !== null && <> · {manager.overallPoints} pts overall</>}
                {manager.overallRank !== null && <> · rank {manager.overallRank.toLocaleString()}</>}
              </p>
              <button onClick={disconnectTeam}>Disconnect</button>
            </section>

            <div className="league-layout">
              <aside className="panel league-list">
                <span className="eyebrow">YOUR LEAGUES</span>
                {managerLeagues.filter((league) => league.type === "invitational").length > 0 && (
                  <div className="league-group">
                    <small>Mini-leagues</small>
                    {managerLeagues.filter((league) => league.type === "invitational").map((league) => (
                      <button
                        key={league.id}
                        className={selectedLeagueId === league.id ? "league-item active" : "league-item"}
                        onClick={() => void openLeague(league.id)}
                      >
                        <b>{league.name}</b>
                        <small>{league.rank ? `Rank ${league.rank}` : "Not yet ranked"}{league.entryCount ? ` of ${league.entryCount}` : ""}</small>
                      </button>
                    ))}
                  </div>
                )}
                <div className="league-group">
                  <small>Auto-joined</small>
                  {managerLeagues.filter((league) => league.type === "system").map((league) => (
                    <button
                      key={league.id}
                      className={selectedLeagueId === league.id ? "league-item active" : "league-item"}
                      onClick={() => void openLeague(league.id)}
                    >
                      <b>{league.name}</b>
                      <small>{league.rank ? `Rank ${league.rank}` : "Not yet ranked"}</small>
                    </button>
                  ))}
                </div>
              </aside>

              <div className="league-main">
                {leagueStatus === "loading" && (
                  <article className="panel"><div className="picker-empty">Loading league insights…</div></article>
                )}
                {leagueStatus === "error" && (
                  <article className="panel"><div className="picker-empty">That league could not be loaded. It may be private.</div></article>
                )}
                {leagueStatus === "idle" && !leagueInsights && (
                  <article className="panel"><div className="picker-prompt"><span>←</span><b>Choose a league</b><p>Monthly awards and manager insights will appear here.</p></div></article>
                )}

                {leagueInsights && (
                  <>
                    <article className="panel">
                      <div className="panel-head">
                        <div><span className="eyebrow">{leagueInsights.league.type === "invitational" ? "MINI-LEAGUE" : "AUTO-JOINED LEAGUE"}</span><h2>{leagueInsights.league.name}</h2></div>
                        <span className="confidence">{leagueInsights.league.analysedCount} managers analysed</span>
                      </div>
                      {leagueInsights.completedGameweeks === 0 ? (
                        <div className="preseason-note">
                          <b>The season has not started yet.</b>
                          <p>
                            Monthly awards unlock once Gameweek 1 is scored.
                            {leagueInsights.league.entryCount > 0
                              ? ` ${leagueInsights.league.entryCount} ${leagueInsights.league.entryCount === 1 ? "manager is" : "managers are"} ready to go.`
                              : " Standings appear here once the official feed ranks this league."}
                          </p>
                          <div className="badge-slots">
                            {["August", "September", "October", "November"].map((month) => (
                              <div className="badge-slot" key={month}><i>★</i><b>{month}</b><small>Locked</small></div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="explain-stat"><span>Gameweeks scored</span><b>{leagueInsights.completedGameweeks}</b></div>
                      )}
                      {leagueInsights.league.truncated && (
                        <p className="model-note">This league is larger than the analysed sample. The top {leagueInsights.league.analysedCount} managers are shown.</p>
                      )}
                    </article>

                    {monthlyBadges.length > 0 && (
                      <article className="panel">
                        <div className="panel-head"><div><span className="eyebrow">HONOURS BOARD</span><h2>Manager of the Month</h2></div><span className="subtle">Net of transfer hits</span></div>
                        <div className="badge-grid">
                          {monthlyBadges.map((badge) => (
                            <div className="badge-card" key={`${badge.period}-${badge.entryId}`}>
                              <i>★</i>
                              <span className="badge-month">{badge.period}</span>
                              <b>{badge.teamName}</b>
                              <small>{badge.managerName}</small>
                              <strong>{badge.value} pts</strong>
                              <p>{badge.detail}</p>
                            </div>
                          ))}
                        </div>
                      </article>
                    )}

                    {currentMonth && (
                      <article className="panel">
                        <div className="panel-head">
                          <div><span className="eyebrow">{currentMonth.month.complete ? "FINAL STANDINGS" : "THIS MONTH'S RACE"}</span><h2>{currentMonth.month.name}</h2></div>
                          <span className="subtle">GW{currentMonth.month.startEvent}–{currentMonth.month.stopEvent} · {currentMonth.month.gameweeksPlayed} played</span>
                        </div>
                        <div className="month-table">
                          <div className="month-row month-head"><span>#</span><span>Manager</span><span>Net</span><span>Gross</span><span>Hits</span><span>Bench</span></div>
                          {currentMonth.standings.slice(0, 12).map((row) => (
                            <div className={row.rank === 1 ? "month-row leading" : "month-row"} key={row.entryId}>
                              <span>{row.rank === 1 ? "★" : row.rank}</span>
                              <span><b>{row.teamName}</b><small>{row.managerName}</small></span>
                              <span className="month-net">{row.netPoints}</span>
                              <span>{row.grossPoints}</span>
                              <span className={row.transferCost > 0 ? "negative" : undefined}>{row.transferCost > 0 ? `−${row.transferCost}` : "—"}</span>
                              <span>{row.pointsOnBench}</span>
                            </div>
                          ))}
                        </div>
                      </article>
                    )}

                    {seasonBadges.length > 0 && (
                      <article className="panel">
                        <div className="panel-head"><div><span className="eyebrow">SEASON AWARDS</span><h2>League character</h2></div></div>
                        <div className="season-badge-row">
                          {seasonBadges.map((badge) => (
                            <div className="season-badge" key={badge.kind}>
                              <i>{BADGE_ICONS[badge.kind] ?? "◆"}</i>
                              <div><b>{badge.label}</b><small>{badge.teamName} · {badge.value}{badge.unit === "sd" ? " sd" : " pts"}</small><p>{badge.detail}</p></div>
                            </div>
                          ))}
                        </div>
                      </article>
                    )}

                    {leagueInsights.managers.some((row) => row.totalPoints > 0) && (
                      <article className="panel">
                        <div className="panel-head"><div><span className="eyebrow">MANAGER BREAKDOWN</span><h2>Season to date</h2></div></div>
                        <div className="month-table">
                          <div className="month-row manager-row month-head"><span>Manager</span><span>Net</span><span>Bench</span><span>Hits</span><span>Best</span><span>Swing</span><span>Months</span></div>
                          {leagueInsights.managers.slice(0, 20).map((row) => (
                            <div className="month-row manager-row" key={row.entryId}>
                              <span><b>{row.teamName}</b><small>{row.managerName}</small></span>
                              <span className="month-net">{row.totalPoints}</span>
                              <span>{row.benchPoints}</span>
                              <span className={row.transferCost > 0 ? "negative" : undefined}>{row.transferCost > 0 ? `−${row.transferCost}` : "—"}</span>
                              <span>{row.bestGameweek ? `${row.bestGameweek.points}` : "—"}</span>
                              <span>{row.consistency ?? "—"}</span>
                              <span>{row.monthsWon > 0 ? "★".repeat(Math.min(row.monthsWon, 5)) : "—"}</span>
                            </div>
                          ))}
                        </div>
                        <p className="model-note">Net points deduct transfer costs. Swing is the standard deviation of Gameweek scores; a lower number means a steadier season.</p>
                      </article>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
  );
}
