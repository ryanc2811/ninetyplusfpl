"use client";

/**
 * Application state.
 *
 * Every screen reads the same projection output, the same editable squad and
 * the same connected manager, so the state that used to live in one page
 * component lives here instead and the routes stay thin. Splitting it per
 * route would have meant rebuilding the draft on every navigation.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type {
  BacktestSummary,
  ExpectedMinutesProjection,
  FplProjectionResponse,
  PlayerPointsProjection,
  PointsBreakdown,
  TeamOutlook,
} from "../../lib/contracts/fpl";
import type {
  LeagueInsightsResponse,
  LeagueSummary,
  ManagerLeaguesResponse,
  ManagerSummary,
} from "../../lib/contracts/leagues";
import { createChipPlan, managerChoicesFromPlan, squadStrategyForGameweek, validateChipPlan, type ChipPlanItem } from "../../lib/chip-strategy";
import { optimiseSquad, pitchLayout, projectedStrategyPoints, replaceSquadPlayer, replacementError, resolveCaptaincy, selectBestLineup, selectLineup, swapLineupPlayer, templateLineup, validateLineup, validateSquad, type Formation, type SquadAsset } from "../../lib/squad-builder";

export type Position = "GK" | "DEF" | "MID" | "FWD";
export type Player = {
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
  teamExpectedGoalsConceded?: number;
  cleanSheetProbability?: number;
  pointsDistribution?: PlayerPointsProjection;
  pointsBreakdown?: PointsBreakdown;
  rates?: {
    expectedGoals: number;
    expectedAssists: number;
    defensiveActions: number;
    observationWeight: number;
  };
};

export const BREAKDOWN_LABELS: Array<[keyof PointsBreakdown, string]> = [
  ["appearance", "Appearance"],
  ["goals", "Goals"],
  ["assists", "Assists"],
  ["cleanSheet", "Clean sheet"],
  ["defensiveContribution", "Def. contribution"],
  ["saves", "Saves"],
  ["bonus", "Bonus"],
  ["goalsConceded", "Goals conceded"],
  ["cards", "Cards"],
];

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

export const BADGE_ICONS: Record<string, string> = {
  "manager-of-the-month": "★",
  "best-gameweek": "▲",
  "bench-regret": "▽",
  "hit-taker": "✂",
  "most-consistent": "◈",
};

const TEAM_ID_STORAGE_KEY = "ninety-plus:fpl-team-id";
const THEME_STORAGE_KEY = "ninety-plus:theme";

/**
 * The theme lives outside React: an attribute on <html>, a localStorage entry
 * and the OS preference. It is read through useSyncExternalStore so the toggle
 * label always reflects what is actually applied.
 */
export type Theme = "light" | "dark";
const themeListeners = new Set<() => void>();

function subscribeToTheme(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  themeListeners.add(onChange);
  media.addEventListener("change", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    themeListeners.delete(onChange);
    media.removeEventListener("change", onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readTheme(): Theme {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The server cannot know the preference; the inline head script corrects it. */
function readServerTheme(): Theme {
  return "light";
}

export function writeTheme(next: Theme) {
  document.documentElement.setAttribute("data-theme", next);
  window.localStorage.setItem(THEME_STORAGE_KEY, next);
  themeListeners.forEach((listener) => listener());
}

/**
 * Eases a number toward its target so headline figures land rather than snap.
 * Returns the target immediately when the user has asked for reduced motion.
 */
function useCountUp(target: number, decimals = 1) {
  const [display, setDisplay] = useState(target);
  const previous = useRef(target);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = previous.current;
    previous.current = target;
    if (reduced || from === target) {
      setDisplay(target);
      return;
    }
    const duration = 520;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      // easeOutCubic
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(from + (target - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return display.toFixed(decimals);
}

function useAppStateValue() {
  const router = useRouter();
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
  const [nextDeadline, setNextDeadline] = useState<string | null>(null);
  const [nextEvent, setNextEvent] = useState(1);
  const [teamOutlook, setTeamOutlook] = useState<TeamOutlook[]>([]);
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
  const theme = useSyncExternalStore(subscribeToTheme, readTheme, readServerTheme);
  const [teamIdInput, setTeamIdInput] = useState("");
  const [manager, setManager] = useState<ManagerSummary | null>(null);
  const [managerLeagues, setManagerLeagues] = useState<LeagueSummary[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<number | null>(null);
  const [leagueInsights, setLeagueInsights] = useState<LeagueInsightsResponse | null>(null);
  const [connectStatus, setConnectStatus] = useState<"idle" | "loading" | "error">("idle");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [leagueStatus, setLeagueStatus] = useState<"idle" | "loading" | "error">("idle");

  async function fetchManagerLeagues(entryId: number): Promise<ManagerLeaguesResponse> {
    const response = await fetch(`/api/leagues?entry=${entryId}`);
    const data = (await response.json()) as ManagerLeaguesResponse & { detail?: string };
    if (!response.ok) throw new Error(data.detail || "Could not load that team.");
    return data;
  }

  function applyManager(payload: ManagerLeaguesResponse, entryId: number) {
    setManager(payload.manager);
    setManagerLeagues(payload.leagues);
    setConnectStatus("idle");
    window.localStorage.setItem(TEAM_ID_STORAGE_KEY, String(entryId));
    const firstInvitational = payload.leagues.find((league) => league.type === "invitational");
    if (firstInvitational) void openLeague(firstInvitational.id);
  }

  async function connectTeam(rawId: string) {
    const entryId = Number(rawId.trim());
    if (!Number.isInteger(entryId) || entryId <= 0) {
      setConnectStatus("error");
      setConnectError("Enter the numeric team ID from your FPL 'Points' page URL.");
      return;
    }
    setConnectStatus("loading");
    setConnectError(null);
    try {
      applyManager(await fetchManagerLeagues(entryId), entryId);
    } catch (error) {
      setConnectStatus("error");
      setConnectError(error instanceof Error ? error.message : "Could not load that team.");
    }
  }

  async function openLeague(leagueId: number) {
    setSelectedLeagueId(leagueId);
    setLeagueStatus("loading");
    setLeagueInsights(null);
    try {
      const response = await fetch(`/api/leagues/${leagueId}`);
      if (!response.ok) throw new Error("League unavailable");
      setLeagueInsights((await response.json()) as LeagueInsightsResponse);
      setLeagueStatus("idle");
    } catch {
      setLeagueStatus("error");
    }
  }

  function disconnectTeam() {
    setManager(null);
    setManagerLeagues([]);
    setSelectedLeagueId(null);
    setLeagueInsights(null);
    setTeamIdInput("");
    window.localStorage.removeItem(TEAM_ID_STORAGE_KEY);
  }

  // Restore a previously connected team. Every state update happens after the
  // request resolves, so mounting does not trigger a cascading render.
  useEffect(() => {
    const stored = window.localStorage.getItem(TEAM_ID_STORAGE_KEY);
    const entryId = Number(stored);
    if (!stored || !Number.isInteger(entryId) || entryId <= 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const payload = await fetchManagerLeagues(entryId);
        if (cancelled) return;
        setTeamIdInput(stored);
        applyManager(payload, entryId);
      } catch {
        if (!cancelled) window.localStorage.removeItem(TEAM_ID_STORAGE_KEY);
      }
    })();
    return () => { cancelled = true; };
    // Restoring a saved team ID is a mount-time action only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const monthlyBadges = useMemo(
    () => (leagueInsights?.badges ?? []).filter((badge) => badge.kind === "manager-of-the-month"),
    [leagueInsights],
  );
  const seasonBadges = useMemo(
    () => (leagueInsights?.badges ?? []).filter((badge) => badge.kind !== "manager-of-the-month"),
    [leagueInsights],
  );
  const currentMonth = useMemo(
    () => leagueInsights?.months.find((entry) => entry.month.current)
      ?? [...(leagueInsights?.months ?? [])].reverse()[0]
      ?? null,
    [leagueInsights],
  );

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
          setModelVersion(data.model?.version || "component-xp-v1");
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
          setNextDeadline(data.nextDeadline ?? null);
          setNextEvent(data.nextEvent ?? 1);
          setTeamOutlook(data.teamOutlook ?? []);
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
  const template = useMemo(
    () => templateLineup(
      players.map((player) => ({ ...playerToSquadAsset(player), ownership: player.ownership })),
      1,
    ),
    [players],
  );
  const templateEdge = template ? Number((projectedGw1 - template.points).toFixed(1)) : null;
  // What share of the whole 15-player squad's projection the chosen XI captures.
  const squadCapture = useMemo(() => {
    const squadTotal = builderSquad.reduce((total, player) => total + player.xp1, 0);
    if (squadTotal <= 0) return 0;
    const startingTotal = builderStarters.reduce((total, player) => total + player.xp1, 0);
    return Math.round((startingTotal / squadTotal) * 100);
  }, [builderSquad, builderStarters]);
  const animatedGw1 = useCountUp(projectedGw1);
  const animatedGw3 = useCountUp(projectedGw3);
  const animatedSquadValue = useCountUp(builderValidation.cost);
  const deadlineLabel = useMemo(() => {
    if (!nextDeadline) return "DEADLINE PENDING";
    const date = new Date(nextDeadline);
    if (Number.isNaN(date.getTime())) return "DEADLINE PENDING";
    return `DEADLINE ${date.toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).toUpperCase()}`;
  }, [nextDeadline]);

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
    router.push("/squad");
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
  return {
    // Projection feed
    players, live, feedStatus, modelVersion, expectedMinutesVersion,
    teamOpportunityAdjustedCount, teamLineupAdjustedCount, backtest,
    teamModelVersion, pointsModelVersion, simulationCount, eventModelVersion,
    updatedAt, nextDeadline, nextEvent, deadlineLabel, teamOutlook,

    // Player lab
    range, setRange, position, setPosition, query, setQuery,
    visibleCount, setVisibleCount, selectedPlayerId, setSelectedPlayerId,
    shownPlayers, projectionLeaders,

    // Squad builder
    builderSquad, formation, starterIds, captainId, viceCaptainId,
    selectedSlotId, setSelectedSlotId, selectedSlot, builderQuery, setBuilderQuery,
    builderMessage, builderValidation, lineupValidation, builderStarters,
    builderBench, builderPitch, builderCandidates, legalBenchSwaps,
    optimising, optimised, squadCapture, transferSuggestion,
    template, templateEdge, captain, captainEdge,
    projectedGw1, projectedGw3, animatedGw1, animatedGw3, animatedSquadValue,
    runOptimiser, selectBuilderSlot, chooseReplacement, changeFormation,
    applyLineupSwap, promoteBenchPlayer, moveBenchPlayer, resetDraft,
    assignCaptain, assignViceCaptain,

    // Chip planner
    chipPlan, chipPlanValidation, gw1Strategy, nextPlannedChip, strategyMessage,
    updateChipChoice, applyChipStrategy,

    // Leagues
    teamIdInput, setTeamIdInput, manager, managerLeagues, selectedLeagueId,
    leagueInsights, connectStatus, connectError, leagueStatus,
    monthlyBadges, seasonBadges, currentMonth,
    connectTeam, openLeague, disconnectTeam,

    // Theme
    theme,
  };
}

type AppState = ReturnType<typeof useAppStateValue>;

const AppStateContext = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const value = useAppStateValue();
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const value = useContext(AppStateContext);
  if (!value) throw new Error("useAppState must be used inside AppStateProvider");
  return value;
}
