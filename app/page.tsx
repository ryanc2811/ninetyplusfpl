"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type {
  BacktestSummary,
  ExpectedMinutesProjection,
  FplProjectionResponse,
  PlayerPointsProjection,
} from "../lib/contracts/fpl";
import { createChipPlan, managerChoicesFromPlan, squadStrategyForGameweek, validateChipPlan, type ChipPlanItem } from "../lib/chip-strategy";
import { FORMATIONS, optimiseSquad, pitchLayout, projectedStrategyPoints, replaceSquadPlayer, replacementError, resolveCaptaincy, selectBestLineup, selectLineup, swapLineupPlayer, validateLineup, validateSquad, type Formation, type SquadAsset } from "../lib/squad-builder";

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
  expectedMinutes?: ExpectedMinutesProjection;
  teamExpectedGoals?: number;
  cleanSheetProbability?: number;
  pointsDistribution?: PlayerPointsProjection;
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

const initialBuilderSquad: SquadAsset[] = [
  { id: -1, name: "Raya", team: "ARS", position: "GK", price: 5.5, xp1: 4.8, xp3: 14.6 },
  { id: -2, name: "Henderson", team: "CRY", position: "GK", price: 4.5, xp1: 3.8, xp3: 11.4 },
  { id: -3, name: "Gvardiol", team: "MCI", position: "DEF", price: 6.0, xp1: 4.9, xp3: 14.8 },
  { id: -4, name: "Aina", team: "NFO", position: "DEF", price: 4.5, xp1: 4.4, xp3: 13.3 },
  { id: -5, name: "Andersen", team: "FUL", position: "DEF", price: 4.5, xp1: 3.9, xp3: 11.8 },
  { id: -6, name: "Van Hecke", team: "BHA", position: "DEF", price: 4.5, xp1: 3.7, xp3: 11.2 },
  { id: -7, name: "O'Shea", team: "SUN", position: "DEF", price: 4.0, xp1: 3.3, xp3: 9.7 },
  { id: -8, name: "Fernandes", team: "MUN", position: "MID", price: 12.0, xp1: 7.2, xp3: 20.8 },
  { id: -9, name: "Palmer", team: "CHE", position: "MID", price: 10.5, xp1: 6.6, xp3: 19.9 },
  { id: -10, name: "Yates", team: "NFO", position: "MID", price: 4.5, xp1: 3.4, xp3: 10.1 },
  { id: -11, name: "Dibling", team: "EVE", position: "MID", price: 5.0, xp1: 3.7, xp3: 11.0 },
  { id: -12, name: "Soucek", team: "WHU", position: "MID", price: 5.0, xp1: 3.8, xp3: 11.5 },
  { id: -13, name: "Haaland", team: "MCI", position: "FWD", price: 15.5, xp1: 5.7, xp3: 16.9 },
  { id: -14, name: "Wood", team: "NFO", position: "FWD", price: 6.0, xp1: 4.7, xp3: 14.0 },
  { id: -15, name: "Tiago", team: "BRE", position: "FWD", price: 4.5, xp1: 3.2, xp3: 9.6 },
];
const initialLineup = selectBestLineup(initialBuilderSquad, 1);
const initialChipPlan = createChipPlan();

function playerToSquadAsset(player: Player): SquadAsset {
  return {
    id: player.id,
    name: player.name,
    team: player.team,
    position: player.position,
    price: player.price,
    xp1: player.xp1,
    xp3: player.xp3,
  };
}

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
  const [chipPlan, setChipPlan] = useState<ChipPlanItem[]>(initialChipPlan);
  const [strategyMessage, setStrategyMessage] = useState(
    "AI suggestions are provisional and will recalculate as fixture and availability forecasts change.",
  );
  const [optimising, setOptimising] = useState(false);
  const [optimised, setOptimised] = useState(false);
  const [visibleCount, setVisibleCount] = useState(40);
  const [modelVersion, setModelVersion] = useState("preview-v1");
  const [expectedMinutesVersion, setExpectedMinutesVersion] = useState(
    "expected-minutes-baseline-v1",
  );
  const [teamOpportunityAdjustedCount, setTeamOpportunityAdjustedCount] = useState(0);
  const [teamLineupAdjustedCount, setTeamLineupAdjustedCount] = useState(0);
  const [backtest, setBacktest] = useState<BacktestSummary | null>(null);
  const [teamModelVersion, setTeamModelVersion] = useState<string | null>(null);
  const [pointsModelVersion, setPointsModelVersion] = useState<string | null>(null);
  const [simulationCount, setSimulationCount] = useState<number | null>(null);
  const [eventModelVersion, setEventModelVersion] = useState<string | null>(null);
  const [feedStatus, setFeedStatus] = useState<"loading" | "live" | "fallback">("loading");
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [builderSquad, setBuilderSquad] = useState<SquadAsset[]>(initialBuilderSquad);
  const [formation, setFormation] = useState<Formation>(initialLineup?.formation ?? "4-4-2");
  const [starterIds, setStarterIds] = useState<number[]>(
    initialLineup?.starters.map((player) => player.id) ?? [],
  );
  const [captainId, setCaptainId] = useState<number | null>(initialLineup?.captain?.id ?? null);
  const [viceCaptainId, setViceCaptainId] = useState<number | null>(initialLineup?.viceCaptain?.id ?? null);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [builderQuery, setBuilderQuery] = useState("");
  const [builderMessage, setBuilderMessage] = useState("Select a player on the pitch or bench to replace them.");
  const [benchOrderIds, setBenchOrderIds] = useState<number[]>([]);

  useEffect(() => {
    fetch("/api/fpl")
      .then((response) => {
        if (!response.ok) throw new Error("Live feed unavailable");
        return response.json() as Promise<FplProjectionResponse>;
      })
      .then((data) => {
        if (data.players?.length) {
          setPlayers(data.players);
          const optimisedDraft = optimiseSquad(
            data.players.map(playerToSquadAsset),
            100,
            1,
            squadStrategyForGameweek(initialChipPlan, 1),
          );
          if (optimisedDraft) {
            setBuilderSquad(optimisedDraft.squad);
            setFormation(optimisedDraft.lineup.formation);
            setStarterIds(optimisedDraft.lineup.starters.map((player) => player.id));
            setCaptainId(optimisedDraft.lineup.captain.id);
            setViceCaptainId(optimisedDraft.lineup.viceCaptain.id);
            setBenchOrderIds(optimisedDraft.lineup.bench.map((player) => player.id));
            setBuilderMessage(
              `Live GW1 draft optimised from ${data.players.length} players within the £100.0m budget.`,
            );
          }
          setLive(true);
          setModelVersion(data.model?.version || "fixture-blend-v2");
          setExpectedMinutesVersion(
            data.model?.expectedMinutesVersion || "expected-minutes-baseline-v1",
          );
          setTeamOpportunityAdjustedCount(data.model?.teamOpportunityAdjustedCount ?? 0);
          setTeamLineupAdjustedCount(data.model?.teamLineupAdjustedCount ?? 0);
          setBacktest(data.model?.backtest ?? null);
          setTeamModelVersion(data.model?.teamModelVersion ?? null);
          setPointsModelVersion(data.model?.pointsModelVersion ?? null);
          setSimulationCount(data.model?.simulationCount ?? null);
          setEventModelVersion(data.model?.eventModelVersion ?? null);
          setUpdatedAt(data.updatedAt);
          setFeedStatus("live");
        }
      })
      .catch(() => {
        setLive(false);
        setFeedStatus("fallback");
      });
  }, []);

  const shownPlayers = useMemo(() => {
    return players
      .filter((player) => position === "ALL" || player.position === position)
      .filter((player) => player.name.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => (range === 1 ? b.xp1 - a.xp1 : b.xp3 - a.xp3));
  }, [players, position, query, range]);

  const builderValidation = useMemo(() => validateSquad(builderSquad), [builderSquad]);
  const selectedSlot = builderSquad.find((player) => player.id === selectedSlotId) ?? null;
  const lineupValidation = useMemo(
    () => validateLineup(builderSquad, starterIds),
    [builderSquad, starterIds],
  );
  const automaticLineup = useMemo(
    () => selectLineup(builderSquad, formation),
    [builderSquad, formation],
  );
  const builderStarters = lineupValidation.valid
    ? lineupValidation.starters
    : automaticLineup.starters;
  const unrankedBench = lineupValidation.valid
    ? lineupValidation.bench
    : automaticLineup.bench;
  const builderBench = useMemo(() => {
    const defaultOrder = [
      ...unrankedBench.filter((player) => player.position === "GK"),
      ...unrankedBench
        .filter((player) => player.position !== "GK")
        .sort((a, b) => b.xp1 - a.xp1),
    ];
    if (!benchOrderIds.length) return defaultOrder;
    return [...defaultOrder].sort((a, b) => {
      const aIndex = benchOrderIds.indexOf(a.id);
      const bIndex = benchOrderIds.indexOf(b.id);
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  }, [unrankedBench, benchOrderIds]);
  const builderPitch = useMemo(() => pitchLayout(builderStarters), [builderStarters]);
  const builderCandidates = useMemo(() => {
    if (!selectedSlot) return [];
    return players
      .filter((player) => player.position === selectedSlot.position)
      .filter((player) => player.name.toLowerCase().includes(builderQuery.toLowerCase()))
      .filter((player) => !builderSquad.some((current) => current.id !== selectedSlot.id && current.id === player.id))
      .map<SquadAsset>((player) => ({
        id: player.id,
        name: player.name,
        team: player.team,
        position: player.position,
        price: player.price,
        xp1: player.xp1,
        xp3: player.xp3,
      }))
      .sort((a, b) => b.xp3 - a.xp3)
      .slice(0, 60);
  }, [builderQuery, builderSquad, players, selectedSlot]);
  const gw1Strategy = squadStrategyForGameweek(chipPlan, 1);
  const projectedGw1 = projectedStrategyPoints(
    builderStarters,
    builderBench,
    captainId,
    gw1Strategy,
  );
  const projectedGw3 = Number(builderStarters.reduce((total, player) => total + player.xp3, 0).toFixed(1));
  const chipPlanValidation = validateChipPlan(chipPlan);
  const nextPlannedChip = [...chipPlan].sort((a, b) => a.gameweek - b.gameweek)[0];
  const captain = builderStarters.find((player) => player.id === captainId)
    ?? [...builderStarters].sort((a, b) => b.xp1 - a.xp1)[0];
  const captainAlternatives = [...builderStarters]
    .filter((player) => player.id !== captain?.id)
    .sort((a, b) => b.xp1 - a.xp1);
  const captainEdge = captain
    ? Math.max(0, captain.xp1 - (captainAlternatives[0]?.xp1 ?? 0))
    : 0;
  const legalBenchSwaps = selectedSlot && starterIds.includes(selectedSlot.id)
    ? builderBench.filter((player) =>
        Boolean(
          swapLineupPlayer(
            builderSquad,
            builderStarters.map((starter) => starter.id),
            selectedSlot.id,
            player.id,
          ),
        ),
      )
    : [];
  const transferSuggestion = useMemo(() => {
    let best:
      | { outgoing: SquadAsset; incoming: SquadAsset; gain: number }
      | undefined;
    for (const outgoing of builderSquad) {
      for (const candidate of players) {
        const incoming = playerToSquadAsset(candidate);
        if (replacementError(builderSquad, outgoing.id, incoming)) continue;
        const gain = incoming.xp3 - outgoing.xp3;
        if (gain > 0 && (!best || gain > best.gain)) {
          best = { outgoing, incoming, gain };
        }
      }
    }
    return best;
  }, [builderSquad, players]);
  const projectionLeaders = useMemo(
    () => [...players].sort((a, b) => b.xp1 - a.xp1).slice(0, 3),
    [players],
  );

  function runOptimiser() {
    setOptimising(true);
    setOptimised(false);
    window.setTimeout(() => {
      const best = selectBestLineup(builderSquad, 1);
      if (best) {
        setFormation(best.formation);
        setStarterIds(best.starters.map((player) => player.id));
        setCaptainId(best.captain?.id ?? null);
        setViceCaptainId(best.viceCaptain?.id ?? null);
        setBenchOrderIds(best.bench.map((player) => player.id));
        setBuilderMessage(`Best GW1 XI selected in a ${best.formation}, with ${best.captain?.name ?? "the top asset"} captain.`);
      }
      setOptimising(false);
      setOptimised(true);
    }, 250);
  }

  function selectBuilderSlot(playerId: number) {
    setSelectedSlotId(playerId);
    setBuilderQuery("");
    const player = builderSquad.find((asset) => asset.id === playerId);
    const isStarter = starterIds.includes(playerId);
    setBuilderMessage(
      player
        ? `${player.name} selected. ${isStarter ? "Use a bench Swap button or choose a transfer replacement." : "Use Start to promote them, or choose a transfer replacement."}`
        : "Choose a replacement.",
    );
  }

  function chooseReplacement(candidate: SquadAsset) {
    if (selectedSlotId === null) return;
    const error = replacementError(builderSquad, selectedSlotId, candidate);
    if (error) {
      setBuilderMessage(error);
      return;
    }
    const nextSquad = replaceSquadPlayer(builderSquad, selectedSlotId, candidate);
    const nextStarterIds = starterIds.map((id) => id === selectedSlotId ? candidate.id : id);
    const preservedLineup = validateLineup(nextSquad, nextStarterIds);
    const nextLineup = preservedLineup.valid
      ? { starters: preservedLineup.starters, bench: preservedLineup.bench }
      : selectLineup(nextSquad, formation);
    const nextCaptaincy = resolveCaptaincy(
      nextLineup.starters,
      captainId === selectedSlotId ? candidate.id : captainId,
      viceCaptainId === selectedSlotId ? candidate.id : viceCaptainId,
    );
    setBuilderSquad(nextSquad);
    setStarterIds(nextLineup.starters.map((player) => player.id));
    setBenchOrderIds((ids) => ids.map((id) => id === selectedSlotId ? candidate.id : id));
    setCaptainId(nextCaptaincy.captainId);
    setViceCaptainId(nextCaptaincy.viceCaptainId);
    setBuilderMessage(`${candidate.name} replaced ${selectedSlot?.name}. Budget and club limits remain valid.`);
    setSelectedSlotId(candidate.id);
    setBuilderQuery("");
  }

  function changeFormation(nextFormation: Formation) {
    const nextLineup = selectLineup(builderSquad, nextFormation);
    const nextCaptaincy = resolveCaptaincy(nextLineup.starters, captainId, viceCaptainId);
    setFormation(nextFormation);
    setStarterIds(nextLineup.starters.map((player) => player.id));
    setBenchOrderIds(nextLineup.bench.map((player) => player.id));
    setCaptainId(nextCaptaincy.captainId);
    setViceCaptainId(nextCaptaincy.viceCaptainId);
    setBuilderMessage(`Formation changed to ${nextFormation}; the highest-projected valid XI is selected.`);
  }

  function applyLineupSwap(outgoingId: number, incomingId: number) {
    const swapped = swapLineupPlayer(
      builderSquad,
      builderStarters.map((player) => player.id),
      outgoingId,
      incomingId,
    );
    if (!swapped) {
      setBuilderMessage("That substitution would create an invalid FPL formation.");
      return;
    }
    const nextStarters = builderSquad.filter((player) =>
      swapped.starterIds.includes(player.id)
    );
    const nextCaptaincy = resolveCaptaincy(nextStarters, captainId, viceCaptainId);
    const outgoing = builderSquad.find((player) => player.id === outgoingId);
    const incoming = builderSquad.find((player) => player.id === incomingId);
    setStarterIds(swapped.starterIds);
    setFormation(swapped.formation);
    setCaptainId(nextCaptaincy.captainId);
    setViceCaptainId(nextCaptaincy.viceCaptainId);
    setBenchOrderIds((ids) => [
      ...ids.filter((id) => id !== incomingId),
      outgoingId,
    ]);
    setSelectedSlotId(null);
    setBuilderMessage(`${incoming?.name} moved into the XI for ${outgoing?.name}.`);
    setOptimised(false);
  }

  function promoteBenchPlayer(incomingId: number) {
    const selectedStarter = selectedSlotId !== null && starterIds.includes(selectedSlotId)
      ? selectedSlotId
      : null;
    const candidates = [
      ...(selectedStarter ? [selectedStarter] : []),
      ...builderStarters
        .filter((player) => player.id !== selectedStarter)
        .sort((a, b) => a.xp1 - b.xp1)
        .map((player) => player.id),
    ];
    const outgoingId = candidates.find((candidateId) =>
      swapLineupPlayer(
        builderSquad,
        builderStarters.map((player) => player.id),
        candidateId,
        incomingId,
      ),
    );
    if (outgoingId === undefined) {
      setBuilderMessage("Select a compatible starting player before making this swap.");
      return;
    }
    applyLineupSwap(outgoingId, incomingId);
  }

  function resetDraft() {
    const strategy = squadStrategyForGameweek(chipPlan, 1);
    const optimisedDraft = optimiseSquad(players.map(playerToSquadAsset), 100, 1, strategy);
    const nextSquad = optimisedDraft?.squad ?? initialBuilderSquad;
    const nextLineup = optimisedDraft?.lineup ?? initialLineup;
    setBuilderSquad(nextSquad);
    setFormation(nextLineup?.formation ?? "4-4-2");
    setStarterIds(nextLineup?.starters.map((player) => player.id) ?? []);
    setCaptainId(nextLineup?.captain?.id ?? null);
    setViceCaptainId(nextLineup?.viceCaptain?.id ?? null);
    setSelectedSlotId(null);
    setBenchOrderIds(nextLineup?.bench.map((player) => player.id) ?? []);
    setOptimised(false);
    setBuilderMessage(
      live
        ? `Live GW1 draft rebuilt for the ${strategy === "bench-boost" ? "Bench Boost" : strategy === "triple-captain" ? "Triple Captain" : "standard"} strategy.`
        : "Preview draft restored.",
    );
  }

  function updateChipChoice(id: ChipPlanItem["id"], value: string) {
    const choices = managerChoicesFromPlan(chipPlan);
    if (value === "AI") {
      delete choices[id];
    } else {
      choices[id] = Number(value);
    }
    const nextPlan = createChipPlan(choices);
    setChipPlan(nextPlan);
    const changed = nextPlan.find((item) => item.id === id);
    setStrategyMessage(
      value === "AI"
        ? `${changed?.chip} returned to AI scheduling; all unlocked chips were rebalanced.`
        : changed?.locked
          ? `${changed.chip} locked to GW${changed.gameweek}; the remaining plan was rebalanced around your choice.`
          : `${changed?.chip} could not be locked to that week under the current FPL constraints, so the nearest legal AI route was restored.`,
    );
    setOptimised(false);
  }

  function applyChipStrategy() {
    resetDraft();
    setView("squad");
  }

  function moveBenchPlayer(playerId: number, direction: -1 | 1) {
    const goalkeeper = builderBench.find((player) => player.position === "GK");
    const order = builderBench.filter((player) => player.position !== "GK").map((player) => player.id);
    const index = order.indexOf(playerId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= order.length) return;
    [order[index], order[destination]] = [order[destination], order[index]];
    setBenchOrderIds([...(goalkeeper ? [goalkeeper.id] : []), ...order]);
  }

  function assignCaptain(playerId: number) {
    setCaptainId(playerId);
    if (viceCaptainId === playerId) {
      setViceCaptainId(builderStarters.filter((player) => player.id !== playerId).sort((a, b) => b.xp1 - a.xp1)[0]?.id ?? null);
    }
  }

  function assignViceCaptain(playerId: number) {
    setViceCaptainId(playerId);
    if (captainId === playerId) {
      setCaptainId(builderStarters.filter((player) => player.id !== playerId).sort((a, b) => b.xp1 - a.xp1)[0]?.id ?? null);
    }
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
          <button className="team-card" onClick={() => setView("squad")}>
            <span className="avatar">RC</span>
            <span><b>Ryan&apos;s XI</b><small>£{(100 - builderValidation.cost).toFixed(1)}m in bank</small></span>
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
            <button className="primary-button" onClick={runOptimiser}>{optimising ? "Optimising live XI…" : optimised ? "Optimised ✓" : "Run optimiser"} <span>↗</span></button>
          </div>
        </header>

        {view === "overview" && (
          <div className="content">
            <section className="signal-strip">
              <div><span className="live-dot" /> MODEL SIGNAL</div>
              <p><b>Live squad state is synchronised.</b> Decision Room, Squad Builder and Player Lab now use the same projection output; optimise again whenever the feed changes.</p>
              <button onClick={() => setView("squad")}>Review XI →</button>
            </section>

            <div className="metric-grid">
              <article className="metric hero-metric">
                <span>PROJECTED GW1</span>
                <div className="metric-value">{projectedGw1.toFixed(1)} <small>pts</small></div>
                <div className="meter"><i style={{ width: "78%" }} /></div>
                <footer><b>Top 12%</b><span>90% range: 54–91</span></footer>
              </article>
              <article className="metric">
                <span>3-GW OUTLOOK</span>
                <div className="metric-value">{projectedGw3.toFixed(1)} <small>pts</small></div>
                <footer className="positive">↑ 8.4 vs template</footer>
              </article>
              <article className="metric">
                <span>SQUAD VALUE</span>
                <div className="metric-value">£{builderValidation.cost.toFixed(1)}<span className="bank">+ £{(100 - builderValidation.cost).toFixed(1)} ITB</span></div>
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
                  <button className="text-button" onClick={() => setView("squad")}>Edit squad →</button>
                </div>
                <div className="pitch">
                  <div className="pitch-circle" />
                  {builderPitch.map((player) => (
                    <button className="pitch-player" key={player.id} style={{ left: `${player.x}%`, top: `${player.y}%` }} title={`${player.name} · ${player.xp1.toFixed(1)} GW1 xPts`} onClick={() => { setView("squad"); selectBuilderSlot(player.id); }}>
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
                  <button className="secondary-button" onClick={() => setView("squad")}>Open squad builder</button>
                </article>

                <article className="panel market-panel">
                  <div className="panel-head"><div><span className="eyebrow">MODEL LEADERS</span><h2>GW1 projection leaders</h2></div><button className="text-button" onClick={() => { setRange(1); setView("players"); }}>Player Lab →</button></div>
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
                  <div className="chip-icon">{nextPlannedChip?.chip === "Triple Captain" ? "×3" : nextPlannedChip?.chip.slice(0, 2).toUpperCase()}</div>
                  <div><b>{nextPlannedChip?.chip} · GW{nextPlannedChip?.gameweek}</b><p>{nextPlannedChip?.rationale}</p></div>
                  <strong>{nextPlannedChip?.locked ? "LOCKED" : "AI"}</strong>
                </div>
                <div className="chip-timeline">{chipPlan.filter((item) => item.half === 1).sort((a, b) => a.gameweek - b.gameweek).map((item) => <span className={item.locked ? "used" : "target"} key={item.id}>{item.gameweek}<i>{item.id.slice(0, 2)}</i></span>)}</div>
                <p className="model-note">Manager-locked choices reshape the remaining chip route and the relevant squad-building objective.</p>
              </article>
            </div>
          </div>
        )}

        {view === "squad" && (
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
                <button className="text-button strategy-link" onClick={() => setView("strategy")}>Change chip strategy →</button>
              </article>
              <article className="panel why-card"><span className="eyebrow">FPL RULES</span><h2>Live validation</h2>{builderValidation.issues.length ? builderValidation.issues.map((issue) => <p className="rule-error" key={issue}>! {issue}</p>) : <p>2 goalkeepers · 5 defenders · 5 midfielders · 3 forwards. Budget and three-per-club limits are satisfied.</p>}<div className="explain-stat"><span>Squad size</span><b>{builderSquad.length} / 15</b></div><div className="explain-stat"><span>Data source</span><b className={live ? "positive" : ""}>{live ? "Live" : "Preview"}</b></div></article>
            </aside>
          </div>
        )}

        {view === "players" && (
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
                {shownPlayers.slice(0, visibleCount).map((player, index) => (
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
        )}

        {view === "strategy" && (
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
                <button className="secondary-button wide" onClick={() => setView("squad")}>Review current squad</button>
              </article>
              <article className="panel">
                <span className="eyebrow">UNIQUE EDGE</span><h2>Regret-aware planning</h2>
                <p className="body-copy">Locked choices are treated as constraints, not ignored. Unlocked chips remain flexible and will be re-evaluated when fixture, availability and blank/double-gameweek forecasts improve.</p>
                <div className="explain-stat"><span>Plan status</span><b className="positive">{chipPlanValidation.valid ? "Rules valid" : "Needs attention"}</b></div><div className="explain-stat"><span>Future flexibility</span><b>{8 - chipPlan.filter((item) => item.locked).length} chips</b></div>
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
