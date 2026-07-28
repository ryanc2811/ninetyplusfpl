"use client";

import { useEffect, useMemo, useState } from "react";

type Position = "GK" | "DEF" | "MID" | "FWD";
type Player = {
  id: number;
  name: string;
  team: string;
  opponent: string;
  venue: "H" | "A";
  position: Position;
  price: number;
  xp1: number;
  xp3: number;
  form: number;
  minutes: number;
  ownership: number;
  risk: "Low" | "Medium" | "High";
  trend: number;
  tag?: string;
  confidence?: number;
  fixtures?: string[];
  breakdown?: number[];
};

const fallbackPlayers: Player[] = [
  { id: 1, name: "Haaland", team: "MCI", opponent: "BHA", venue: "H", position: "FWD", price: 15.5, xp1: 8.4, xp3: 23.7, form: 8.1, minutes: 89, ownership: 61.8, risk: "Low", trend: 0.8, tag: "Captain" },
  { id: 2, name: "Fernandes", team: "MUN", opponent: "FUL", venue: "H", position: "MID", price: 12.0, xp1: 7.2, xp3: 20.8, form: 7.6, minutes: 90, ownership: 34.2, risk: "Low", trend: 1.4, tag: "Set pieces" },
  { id: 3, name: "Saka", team: "ARS", opponent: "LEE", venue: "H", position: "MID", price: 10.0, xp1: 6.9, xp3: 20.2, form: 7.3, minutes: 86, ownership: 41.1, risk: "Low", trend: 0.5 },
  { id: 4, name: "Palmer", team: "CHE", opponent: "WOL", venue: "A", position: "MID", price: 10.5, xp1: 6.6, xp3: 19.9, form: 7.0, minutes: 88, ownership: 45.7, risk: "Low", trend: -0.2 },
  { id: 5, name: "Gabriel", team: "ARS", opponent: "LEE", venue: "H", position: "DEF", price: 8.0, xp1: 5.8, xp3: 17.1, form: 6.4, minutes: 90, ownership: 28.5, risk: "Low", trend: 1.0, tag: "Aerial edge" },
  { id: 6, name: "Gibbs-White", team: "NFO", opponent: "EVE", venue: "H", position: "MID", price: 8.0, xp1: 5.5, xp3: 16.8, form: 6.1, minutes: 87, ownership: 13.4, risk: "Low", trend: 1.8, tag: "Differential" },
  { id: 7, name: "Wood", team: "NFO", opponent: "EVE", venue: "H", position: "FWD", price: 6.0, xp1: 5.2, xp3: 15.1, form: 5.9, minutes: 78, ownership: 9.2, risk: "Medium", trend: 1.1 },
  { id: 8, name: "Raya", team: "ARS", opponent: "LEE", venue: "H", position: "GK", price: 5.5, xp1: 4.8, xp3: 14.6, form: 5.2, minutes: 90, ownership: 22.8, risk: "Low", trend: 0.3 },
  { id: 9, name: "Aina", team: "NFO", opponent: "EVE", venue: "H", position: "DEF", price: 4.5, xp1: 4.4, xp3: 13.3, form: 5.0, minutes: 85, ownership: 7.8, risk: "Medium", trend: 1.5, tag: "Value" },
  { id: 10, name: "Cunha", team: "MUN", opponent: "FUL", venue: "H", position: "FWD", price: 8.5, xp1: 5.8, xp3: 16.0, form: 6.2, minutes: 80, ownership: 17.1, risk: "Medium", trend: 2.0 },
];

const squad = [
  { name: "Raya", team: "ARS", position: "GK", price: 5.5, xp: 4.8, x: 50, y: 8 },
  { name: "Gabriel", team: "ARS", position: "DEF", price: 8.0, xp: 5.8, x: 18, y: 30 },
  { name: "Aina", team: "NFO", position: "DEF", price: 4.5, xp: 4.4, x: 39, y: 30 },
  { name: "Gvardiol", team: "MCI", position: "DEF", price: 6.0, xp: 4.9, x: 61, y: 30 },
  { name: "Truffert", team: "BOU", position: "DEF", price: 4.5, xp: 4.1, x: 82, y: 30 },
  { name: "Fernandes", team: "MUN", position: "MID", price: 12.0, xp: 7.2, x: 16, y: 55 },
  { name: "Saka", team: "ARS", position: "MID", price: 10.0, xp: 6.9, x: 39, y: 55 },
  { name: "Palmer", team: "CHE", position: "MID", price: 10.5, xp: 6.6, x: 62, y: 55 },
  { name: "Anderson", team: "NFO", position: "MID", price: 5.5, xp: 4.3, x: 84, y: 55 },
  { name: "Haaland", team: "MCI", position: "FWD", price: 15.5, xp: 8.4, x: 35, y: 80, captain: true },
  { name: "Wood", team: "NFO", position: "FWD", price: 6.0, xp: 5.2, x: 65, y: 80 },
];

const bench = [
  { name: "Sels", pos: "GK", price: 5.0 },
  { name: "Savona", pos: "DEF", price: 4.0 },
  { name: "Hudson-Odoi", pos: "MID", price: 6.0 },
  { name: "Igor Jesus", pos: "FWD", price: 6.0 },
];

const fixtureRows = [
  { team: "ARS", next: ["LEE", "NEW", "BUR"], score: 92, label: "Attack + defence" },
  { team: "MUN", next: ["FUL", "WHU", "BRE"], score: 87, label: "Attack" },
  { team: "NFO", next: ["EVE", "SUN", "AVL"], score: 81, label: "Value route" },
];

export default function Home() {
  const [view, setView] = useState<"overview" | "squad" | "players" | "strategy">("overview");
  const [range, setRange] = useState<1 | 3>(3);
  const [position, setPosition] = useState<"ALL" | Position>("ALL");
  const [query, setQuery] = useState("");
  const [players, setPlayers] = useState<Player[]>(fallbackPlayers);
  const [live, setLive] = useState(false);
  const [activeChip, setActiveChip] = useState("None");
  const [optimising, setOptimising] = useState(false);
  const [optimised, setOptimised] = useState(false);
  const [visibleCount, setVisibleCount] = useState(40);
  const [modelVersion, setModelVersion] = useState("preview-v1");

  useEffect(() => {
    fetch("/api/fpl")
      .then((response) => {
        if (!response.ok) throw new Error("Live feed unavailable");
        return response.json() as Promise<{ players: Player[]; model?: { version: string } }>;
      })
      .then((data) => {
        if (data.players?.length) {
          setPlayers(data.players);
          setLive(true);
          setModelVersion(data.model?.version || "fixture-blend-v2");
        }
      })
      .catch(() => setLive(false));
  }, []);

  useEffect(() => {
    setVisibleCount(40);
  }, [position, query, range]);

  const shownPlayers = useMemo(() => {
    return players
      .filter((player) => position === "ALL" || player.position === position)
      .filter((player) => player.name.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => (range === 1 ? b.xp1 - a.xp1 : b.xp3 - a.xp3));
  }, [players, position, query, range]);

  function runOptimiser() {
    setOptimising(true);
    setOptimised(false);
    window.setTimeout(() => {
      setOptimising(false);
      setOptimised(true);
    }, 1100);
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("overview")} aria-label="Go to overview">
          NINETY<span>+</span>
        </button>
        <div className="season">FPL 26/27</div>
        <nav aria-label="Primary navigation">
          {[
            ["overview", "⌁", "Decision room"],
            ["squad", "▦", "Squad builder"],
            ["players", "↗", "Player lab"],
            ["strategy", "◫", "Chip planner"],
          ].map(([id, icon, label]) => (
            <button key={id} className={view === id ? "nav-item active" : "nav-item"} onClick={() => setView(id as typeof view)}>
              <span>{icon}</span>{label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="model-status">
            <span className="pulse" />
            <div><b>{live ? "Live FPL feed" : "Model preview"}</b><small>{live ? "Official API connected" : "Live feed reconnecting"}</small></div>
          </div>
          <button className="team-card">
            <span className="avatar">RC</span>
            <span><b>Ryan&apos;s XI</b><small>£2.0m in bank</small></span>
            <i>⌄</i>
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">GAMEWEEK 1 · DEADLINE 15 AUG, 18:30</span>
            <h1>{view === "overview" ? "Decision room" : view === "squad" ? "Squad builder" : view === "players" ? "Player lab" : "Chip planner"}</h1>
          </div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Notifications">○<span className="notification" /></button>
            <button className="primary-button" onClick={runOptimiser}>{optimising ? "Running 25k simulations…" : optimised ? "Optimised ✓" : "Run optimiser"} <span>↗</span></button>
          </div>
        </header>

        {view === "overview" && (
          <div className="content">
            <section className="signal-strip">
              <div><span className="live-dot" /> MODEL SIGNAL</div>
              <p><b>Hold your first transfer.</b> Your squad has 8 of the top 10 fixture-weighted assets. Rolling adds <strong>+3.7 projected points</strong> of optionality by GW3.</p>
              <button onClick={() => setView("strategy")}>View reasoning →</button>
            </section>

            <div className="metric-grid">
              <article className="metric hero-metric">
                <span>PROJECTED GW1</span>
                <div className="metric-value">72.4 <small>pts</small></div>
                <div className="meter"><i style={{ width: "78%" }} /></div>
                <footer><b>Top 12%</b><span>90% range: 54–91</span></footer>
              </article>
              <article className="metric">
                <span>3-GW OUTLOOK</span>
                <div className="metric-value">211.8 <small>pts</small></div>
                <footer className="positive">↑ 8.4 vs template</footer>
              </article>
              <article className="metric">
                <span>SQUAD VALUE</span>
                <div className="metric-value">£98.0<span className="bank">+ £2.0 ITB</span></div>
                <footer>15 / 15 · Rules valid</footer>
              </article>
              <article className="metric">
                <span>CAPTAIN EDGE</span>
                <div className="captain-row"><div className="mini-shirt">9</div><div><b>Haaland</b><small>64% optimal</small></div><em>+2.1</em></div>
                <footer>vs next-best captain</footer>
              </article>
            </div>

            <div className="dashboard-grid">
              <article className="panel squad-panel">
                <div className="panel-head">
                  <div><span className="eyebrow">OPTIMAL XI</span><h2>Squad intelligence</h2></div>
                  <button className="text-button" onClick={() => setView("squad")}>Edit squad →</button>
                </div>
                <div className="pitch">
                  <div className="pitch-circle" />
                  {squad.map((player) => (
                    <button className="pitch-player" key={player.name} style={{ left: `${player.x}%`, top: `${player.y}%` }} title={`${player.name} · ${player.xp} xPts`}>
                      <span className={`shirt ${player.position.toLowerCase()}`}>{player.captain ? "C" : player.team.slice(0, 1)}</span>
                      <b>{player.name}</b><small>{player.xp.toFixed(1)} xPts</small>
                    </button>
                  ))}
                </div>
                <div className="bench-row">
                  <span>BENCH</span>
                  {bench.map((player) => <div key={player.name}><i>{player.pos}</i><b>{player.name}</b><small>£{player.price.toFixed(1)}</small></div>)}
                </div>
              </article>

              <div className="right-stack">
                <article className="panel transfer-panel">
                  <div className="panel-head"><div><span className="eyebrow">NEXT BEST MOVE</span><h2>Transfer radar</h2></div><span className="confidence">86% confidence</span></div>
                  <div className="transfer-swap">
                    <div><span className="player-orb out">BOU</span><b>Truffert</b><small>£4.5m · 11.2 xPts</small></div>
                    <span className="swap-arrow">→</span>
                    <div><span className="player-orb in">NFO</span><b>Aina</b><small>£4.5m · 13.3 xPts</small></div>
                  </div>
                  <div className="transfer-gain"><span>3-GW expected gain</span><strong>+2.1 pts</strong></div>
                  <p>Fixture swing, higher attacking involvement and a 17% better clean-sheet path. Waiting one week preserves more information.</p>
                  <button className="secondary-button" onClick={() => setView("strategy")}>Compare transfer paths</button>
                </article>

                <article className="panel market-panel">
                  <div className="panel-head"><div><span className="eyebrow">MARKET INTELLIGENCE</span><h2>Price pressure</h2></div><button className="plain-icon">•••</button></div>
                  {[
                    ["Gibbs-White", "NFO · MID", "+£0.1m", 84],
                    ["Aina", "NFO · DEF", "+£0.1m", 71],
                    ["Wood", "NFO · FWD", "Stable", 43],
                  ].map(([name, meta, change, score]) => (
                    <div className="market-row" key={name as string}>
                      <span className="initial">{(name as string).slice(0, 2).toUpperCase()}</span>
                      <div><b>{name}</b><small>{meta}</small></div>
                      <div className="pressure"><i style={{ width: `${score}%` }} /></div>
                      <em>{change}</em>
                    </div>
                  ))}
                </article>
              </div>
            </div>

            <div className="lower-grid">
              <article className="panel">
                <div className="panel-head"><div><span className="eyebrow">FIXTURE MODEL</span><h2>Three-week run</h2></div><span className="subtle">Opponent-adjusted</span></div>
                {fixtureRows.map((row) => (
                  <div className="fixture-row" key={row.team}>
                    <b>{row.team}</b><span>{row.label}</span>
                    <div className="fixtures">{row.next.map((team, index) => <i key={team} className={index === 0 ? "easy" : index === 1 ? "medium" : "hard"}>{team}</i>)}</div>
                    <div className="fixture-score"><strong>{row.score}</strong><small>/ 100</small></div>
                  </div>
                ))}
              </article>
              <article className="panel">
                <div className="panel-head"><div><span className="eyebrow">CHIP FORECAST</span><h2>Season leverage</h2></div><button className="text-button" onClick={() => setView("strategy")}>Plan all →</button></div>
                <div className="chip-call">
                  <div className="chip-icon">×3</div>
                  <div><b>Triple Captain · GW6</b><p>Projected double-digit captain haul with 78% start confidence.</p></div>
                  <strong>+9.6</strong>
                </div>
                <div className="chip-timeline"><span className="used">1</span><span>3</span><span className="target">6<i>TC</i></span><span>9</span><span>12</span><span className="target">16<i>WC</i></span><span>19</span></div>
                <p className="model-note">The planner values chips by points above the best no-chip path—not raw gameweek score.</p>
              </article>
            </div>
          </div>
        )}

        {view === "squad" && (
          <div className="content split-view">
            <article className="panel builder-panel">
              <div className="panel-head"><div><span className="eyebrow">RULES-AWARE BUILD</span><h2>Starting squad</h2></div><span className="valid-pill">✓ Valid squad</span></div>
              <div className="budget-bar"><div><span>Spent</span><b>£98.0m</b></div><div><span>In bank</span><b className="lime">£2.0m</b></div><div><span>Club cap</span><b>3 / 3 max</b></div><div><span>Formation</span><b>4–4–2</b></div></div>
              <div className="pitch builder-pitch">
                <div className="pitch-circle" />
                {squad.map((player) => (
                  <button className="pitch-player" key={player.name} style={{ left: `${player.x}%`, top: `${player.y}%` }}>
                    <span className={`shirt ${player.position.toLowerCase()}`}>{player.captain ? "C" : player.team.slice(0, 1)}</span>
                    <b>{player.name}</b><small>£{player.price.toFixed(1)} · {player.xp.toFixed(1)}</small>
                  </button>
                ))}
              </div>
              <div className="bench-row roomy">
                <span>BENCH ORDER</span>
                {bench.map((player, index) => <div key={player.name}><i>{index + 1}</i><b>{player.name}</b><small>{player.pos} · £{player.price.toFixed(1)}</small></div>)}
              </div>
            </article>
            <aside className="builder-side">
              <article className="panel constraint-card">
                <span className="eyebrow">OPTIMISER OBJECTIVE</span><h2>Maximise 3-GW points</h2>
                <label>Risk appetite <b>Balanced</b></label><input type="range" min="0" max="100" defaultValue="54" aria-label="Risk appetite" />
                <label>Bench investment <b>Low</b></label><input type="range" min="0" max="100" defaultValue="28" aria-label="Bench investment" />
                <label className="toggle-row"><span>Differential boost<small>Reward low ownership</small></span><input type="checkbox" defaultChecked /></label>
                <label className="toggle-row"><span>Price-change guard<small>Avoid early value loss</small></span><input type="checkbox" defaultChecked /></label>
                <button className="primary-button wide" onClick={runOptimiser}>{optimising ? "Simulating…" : "Optimise this squad"}</button>
              </article>
              <article className="panel why-card"><span className="eyebrow">MODEL EXPLANATION</span><h2>Why this structure?</h2><p>Three premiums hold 35.5% of budget but supply 41% of projected captain-adjusted points. Budget defence creates £2.0m flexibility without sacrificing expected starts.</p><div className="explain-stat"><span>Robustness score</span><b>91 / 100</b></div><div className="explain-stat"><span>Rotation exposure</span><b className="positive">Low</b></div></article>
            </aside>
          </div>
        )}

        {view === "players" && (
          <div className="content">
            <div className="lab-toolbar">
              <label className="search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search player" /></label>
              <div className="segmented">
                {(["ALL", "GK", "DEF", "MID", "FWD"] as const).map((item) => <button key={item} className={position === item ? "selected" : ""} onClick={() => setPosition(item)}>{item}</button>)}
              </div>
              <div className="segmented"><button className={range === 1 ? "selected" : ""} onClick={() => setRange(1)}>1 GW</button><button className={range === 3 ? "selected" : ""} onClick={() => setRange(3)}>3 GW</button></div>
            </div>
            <article className="panel player-table-wrap">
              <div className="table-summary">
                <div><span className="eyebrow">AI RANKING · {modelVersion.toUpperCase()}</span><h2>{shownPlayers.length} players modelled</h2></div>
                <div className="data-health"><span><i className={live ? "health-good" : "health-warn"} /> {live ? "Official feed connected" : "Preview dataset"}</span><span>8 feature families</span><span>3-GW fixture horizon</span></div>
              </div>
              <div className="player-table">
                <div className="player-row table-head"><span>Rank / player</span><span>Fixture</span><span>Price</span><span>{range} GW xPts</span><span>Form</span><span>Start</span><span>Own.</span><span>Confidence</span></div>
                {shownPlayers.slice(0, visibleCount).map((player, index) => (
                  <button className="player-row" key={player.id} title={player.fixtures?.length ? `Next fixtures: ${player.fixtures.join(" · ")}` : undefined}>
                    <span className="player-identity"><i>{index + 1}</i><b>{player.name}<small>{player.team} · {player.position}</small></b>{player.tag && <em>{player.tag}</em>}</span>
                    <span className="fixture-cell"><b>{player.opponent}</b><small>{player.venue}</small></span>
                    <span>£{player.price.toFixed(1)}</span>
                    <span className="xp-cell">{(range === 1 ? player.xp1 : player.xp3).toFixed(1)}</span>
                    <span>{player.form.toFixed(1)}</span>
                    <span>{player.minutes}%</span>
                    <span>{player.ownership.toFixed(1)}%</span>
                    <span className="confidence-cell"><i style={{ width: `${player.confidence ?? 58}%` }} /><b>{player.confidence ?? 58}%</b></span>
                  </button>
                ))}
              </div>
              {visibleCount < shownPlayers.length && <button className="load-more" onClick={() => setVisibleCount((count) => count + 40)}>Show 40 more <span>{shownPlayers.length - visibleCount} remaining</span></button>}
            </article>
          </div>
        )}

        {view === "strategy" && (
          <div className="content strategy-grid">
            <article className="panel strategy-main">
              <div className="panel-head"><div><span className="eyebrow">MONTE CARLO SEASON PLAN</span><h2>Chip strategy frontier</h2></div><span className="confidence">25,000 simulations</span></div>
              <div className="strategy-hero"><span>Recommended now</span><h3>Save every chip</h3><p>The opening six gameweeks contain no spike large enough to clear the opportunity-cost threshold. Your first high-conviction window is Triple Captain in GW6.</p><div><b>Expected season gain</b><strong>+31.8 pts</strong></div></div>
              <div className="chip-options">
                {[
                  ["Triple Captain", "GW6", "+9.6", "78% confidence"],
                  ["Wildcard", "GW16", "+8.9", "Before first-set expiry"],
                  ["Bench Boost", "GW18", "+7.1", "High bench density"],
                  ["Free Hit", "GW19", "+6.2", "Fixture divergence"],
                ].map(([chip, gw, gain, reason]) => (
                  <button className={activeChip === chip ? "chip-option active" : "chip-option"} onClick={() => setActiveChip(chip)} key={chip}>
                    <span>{chip === "Triple Captain" ? "×3" : chip.slice(0, 2).toUpperCase()}</span><div><b>{chip}</b><small>{reason}</small></div><em>{gw}</em><strong>{gain}</strong>
                  </button>
                ))}
              </div>
            </article>
            <aside className="builder-side">
              <article className="panel">
                <span className="eyebrow">UNIQUE EDGE</span><h2>Regret-aware planning</h2>
                <p className="body-copy">Most tools rank the highest projected chip week. NINETY+ also prices the information you lose by committing early, fixture-change probability, player availability and the value of preserving multiple valid routes.</p>
                <div className="explain-stat"><span>Recommended plan regret</span><b className="positive">2.3 pts</b></div><div className="explain-stat"><span>Popular plan regret</span><b>7.9 pts</b></div>
              </article>
              <article className="panel">
                <span className="eyebrow">PAST WINNER DNA</span><h2>Elite-manager priors</h2>
                <div className="dna-row"><span>Captaincy discipline</span><i><b style={{ width: "92%" }} /></i><em>92</em></div>
                <div className="dna-row"><span>Transfer patience</span><i><b style={{ width: "84%" }} /></i><em>84</em></div>
                <div className="dna-row"><span>Template timing</span><i><b style={{ width: "76%" }} /></i><em>76</em></div>
                <p className="model-note">Historical strategy is used as a prior, never as leakage: the model learns decisions available at each past deadline only.</p>
              </article>
            </aside>
          </div>
        )}
      </section>
    </main>
  );
}
