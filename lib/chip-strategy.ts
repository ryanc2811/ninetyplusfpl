export type ChipName =
  | "Bench Boost"
  | "Triple Captain"
  | "Wildcard"
  | "Free Hit";

export type ChipPlanItem = {
  id: "BB1" | "TC1" | "WC1" | "FH1" | "BB2" | "TC2" | "WC2" | "FH2";
  chip: ChipName;
  half: 1 | 2;
  gameweek: number;
  locked: boolean;
  source: "manager" | "AI";
  rationale: string;
};

export type SquadStrategy = "standard" | "bench-boost" | "triple-captain";

const CHIP_DEFINITIONS: Array<Pick<ChipPlanItem, "id" | "chip" | "half">> = [
  { id: "BB1", chip: "Bench Boost", half: 1 },
  { id: "TC1", chip: "Triple Captain", half: 1 },
  { id: "WC1", chip: "Wildcard", half: 1 },
  { id: "FH1", chip: "Free Hit", half: 1 },
  { id: "BB2", chip: "Bench Boost", half: 2 },
  { id: "TC2", chip: "Triple Captain", half: 2 },
  { id: "WC2", chip: "Wildcard", half: 2 },
  { id: "FH2", chip: "Free Hit", half: 2 },
];

const DEFAULT_WEEKS: Record<ChipPlanItem["id"], number> = {
  BB1: 18,
  TC1: 6,
  WC1: 12,
  FH1: 19,
  BB2: 33,
  TC2: 36,
  WC2: 30,
  FH2: 34,
};

function allowedWeeks(item: Pick<ChipPlanItem, "chip" | "half">) {
  const start = item.half === 1 ? 1 : 20;
  const end = item.half === 1 ? 19 : 38;
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
    .filter((gameweek) => !(gameweek === 1 && (item.chip === "Wildcard" || item.chip === "Free Hit")));
}

function nearestAvailableWeek(
  preferred: number,
  item: Pick<ChipPlanItem, "chip" | "half">,
  occupied: Set<number>,
) {
  const weeks = allowedWeeks(item)
    .filter((gameweek) => !occupied.has(gameweek))
    .sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b);
  return weeks[0] ?? allowedWeeks(item)[0];
}

function rationaleFor(item: Pick<ChipPlanItem, "chip" | "half">, gameweek: number, earlyBenchBoost: boolean) {
  if (item.chip === "Bench Boost" && gameweek === 1) {
    return "Uses unlimited pre-season transfers to build 15 active GW1 scorers.";
  }
  if (item.chip === "Wildcard" && item.half === 1 && earlyBenchBoost) {
    return "Brought forward because a GW1 Bench Boost draft may sacrifice longer-term structure.";
  }
  if (item.chip === "Bench Boost") return "Targets a week where projected bench contribution is strongest.";
  if (item.chip === "Triple Captain") return "Targets the strongest premium captain ceiling.";
  if (item.chip === "Wildcard") return "Resets the squad before the next sustained fixture block.";
  return "Preserves one-week squad flexibility for fixture disruption or divergence.";
}

export function createChipPlan(
  managerChoices: Partial<Record<ChipPlanItem["id"], number>> = {},
): ChipPlanItem[] {
  const lockedChoices = CHIP_DEFINITIONS.map((definition) => ({
    ...definition,
    requested: managerChoices[definition.id],
  }));
  const occupied = new Set<number>();
  const result: ChipPlanItem[] = [];

  for (const item of lockedChoices.filter((choice) => choice.requested !== undefined)) {
    const requested = item.requested!;
    const legal = allowedWeeks(item).includes(requested) && !occupied.has(requested);
    const gameweek = legal
      ? requested
      : nearestAvailableWeek(requested, item, occupied);
    occupied.add(gameweek);
    result.push({
      id: item.id,
      chip: item.chip,
      half: item.half,
      gameweek,
      locked: legal,
      source: legal ? "manager" : "AI",
      rationale: legal
        ? "Manager-controlled commitment; remaining chips adapt around it."
        : "The requested week conflicted with an FPL rule, so the nearest legal week was used.",
    });
  }

  const earlyBenchBoost = result.some((item) => item.id === "BB1" && item.gameweek <= 3);
  for (const item of lockedChoices.filter((choice) => choice.requested === undefined)) {
    const preferred = item.id === "WC1" && earlyBenchBoost ? 4 : DEFAULT_WEEKS[item.id];
    const gameweek = nearestAvailableWeek(preferred, item, occupied);
    occupied.add(gameweek);
    result.push({
      id: item.id,
      chip: item.chip,
      half: item.half,
      gameweek,
      locked: false,
      source: "AI",
      rationale: rationaleFor(item, gameweek, earlyBenchBoost),
    });
  }

  return CHIP_DEFINITIONS.map((definition) =>
    result.find((item) => item.id === definition.id)!,
  );
}

export function managerChoicesFromPlan(plan: ChipPlanItem[]) {
  return Object.fromEntries(
    plan
      .filter((item) => item.locked)
      .map((item) => [item.id, item.gameweek]),
  ) as Partial<Record<ChipPlanItem["id"], number>>;
}

export function validateChipPlan(plan: ChipPlanItem[]) {
  const issues: string[] = [];
  const weeks = new Set<number>();
  for (const item of plan) {
    if (!allowedWeeks(item).includes(item.gameweek)) {
      issues.push(`${item.chip} cannot be used in GW${item.gameweek}`);
    }
    if (weeks.has(item.gameweek)) {
      issues.push(`Only one chip can be used in GW${item.gameweek}`);
    }
    weeks.add(item.gameweek);
  }
  const firstFreeHit = plan.find((item) => item.id === "FH1");
  const secondFreeHit = plan.find((item) => item.id === "FH2");
  if (
    firstFreeHit &&
    secondFreeHit &&
    Math.abs(firstFreeHit.gameweek - secondFreeHit.gameweek) === 1
  ) {
    issues.push("Free Hit cannot be used in consecutive gameweeks");
  }
  return { valid: issues.length === 0, issues };
}

export function squadStrategyForGameweek(plan: ChipPlanItem[], gameweek: number): SquadStrategy {
  const active = plan.find((item) => item.gameweek === gameweek);
  if (active?.chip === "Bench Boost") return "bench-boost";
  if (active?.chip === "Triple Captain") return "triple-captain";
  return "standard";
}

