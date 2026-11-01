"use client";

import type { MonthlyResult, MonthWindow } from "../../../lib/contracts/leagues";
import { SegmentedControl, type SegmentedOption } from "../ui";
import { shortMonth } from "./format";

export type MonthChoice =
  | { kind: "played"; key: string; result: MonthlyResult }
  | { kind: "upcoming"; key: string; month: MonthWindow };

/**
 * The three months a manager cares about: the one just gone, the one being
 * played, and the one about to start. The season's full run lives on the
 * awards screen, so this never has to scroll sideways.
 */
export function monthChoices(
  months: MonthlyResult[],
  upcomingMonths: MonthWindow[],
): MonthChoice[] {
  const played = [...months].sort((a, b) => a.month.startEvent - b.month.startEvent);
  const currentIndex = played.findIndex((result) => result.month.current);
  const latest = currentIndex === -1 ? played.length - 1 : currentIndex;

  const choices: MonthChoice[] = [];
  const previous = played[latest - 1];
  if (previous) {
    choices.push({ kind: "played", key: `p${previous.month.phaseId}`, result: previous });
  }
  if (played[latest]) {
    choices.push({ kind: "played", key: `p${played[latest].month.phaseId}`, result: played[latest] });
  }
  const next = [...upcomingMonths].sort((a, b) => a.startEvent - b.startEvent)[0];
  if (next) choices.push({ kind: "upcoming", key: `u${next.phaseId}`, month: next });
  return choices;
}

export function MonthTabs({
  choices,
  value,
  onChange,
  className,
}: {
  choices: MonthChoice[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  const options: Array<SegmentedOption<string>> = choices.map((choice) => ({
    value: choice.key,
    label: shortMonth(choice.kind === "played" ? choice.result.month.name : choice.month.name),
    live: choice.kind === "played" && choice.result.month.current,
  }));

  return (
    <SegmentedControl
      className={className}
      label="Month"
      options={options}
      value={value}
      onChange={onChange}
    />
  );
}
