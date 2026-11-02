"use client";

import { useState } from "react";
import type { ChipPlanItem } from "../../lib/chip-strategy";
import { Button, Card, CardHead, Chip, SegmentedControl } from "../_components/ui";
import { useAppState } from "../_state/app-state";

/** The gameweeks a chip in this half can legally be played in. */
function gameweekOptions(item: ChipPlanItem) {
  const first = item.half === 1 ? 1 : 20;
  return Array.from({ length: 19 }, (_, index) => first + index).filter(
    (gameweek) => !(gameweek === 1 && (item.chip === "Wildcard" || item.chip === "Free Hit")),
  );
}

/** The chip planner. A manager's locked choices are constraints, not suggestions. */
export function ChipsView() {
  const {
    chipPlan,
    chipPlanValidation,
    gw1Strategy,
    projectedGw1,
    strategyMessage,
    updateChipChoice,
    applyChipStrategy,
    nextEvent,
  } = useAppState();

  const [half, setHalf] = useState<"1" | "2">("1");
  const [selectedId, setSelectedId] = useState<ChipPlanItem["id"]>("BB1");

  const shown = chipPlan
    .filter((item) => String(item.half) === half)
    .sort((a, b) => a.gameweek - b.gameweek);
  const selected = chipPlan.find((item) => item.id === selectedId) ?? shown[0];

  return (
    <div className="flex flex-col gap-3 pb-24 medium:gap-4 expanded:pb-0">
      <SegmentedControl
        className="medium:w-[280px]"
        label="Chip set"
        value={half}
        onChange={(next) => {
          setHalf(next);
          const first = chipPlan.find((item) => String(item.half) === next);
          if (first) setSelectedId(first.id);
        }}
        options={[
          { value: "1", label: "GW 1–19" },
          { value: "2", label: "GW 20–38" },
        ]}
      />

      <section aria-label="Your chips" className="grid grid-cols-2 gap-3">
        {shown.map((item) => {
          const active = item.id === selected?.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => setSelectedId(item.id)}
              className={`np-press flex min-h-[var(--row-min)] flex-col gap-1 rounded-md border p-3 text-left ${
                active
                  ? "border-transparent bg-ink text-on-ink"
                  : "border-border bg-surface text-text"
              }`}
            >
              <span
                className={`t-eyebrow ${active ? "text-on-ink-muted" : "text-text-muted"}`}
              >
                {item.locked ? "Yours" : "Model"}
              </span>
              <span className="t-headline">{item.chip}</span>
              <span className={`t-data ${active ? "text-accent" : "text-positive"}`}>
                GW {item.gameweek}
              </span>
            </button>
          );
        })}
      </section>

      {selected && (
        <Card className="flex flex-col gap-3">
          <CardHead
            eyebrow={`${selected.chip} · planned`}
            title={`GW ${selected.gameweek}`}
            aside={
              <Chip tone={selected.locked ? "ink" : "neutral"}>
                {selected.locked ? "Locked by you" : "Model's choice"}
              </Chip>
            }
          />
          <p className="t-body m-0 text-text-muted">{selected.rationale}</p>
          <label className="flex flex-col gap-1">
            <span className="t-label text-text-muted">Play this chip in</span>
            <select
              value={selected.locked ? String(selected.gameweek) : "AI"}
              onChange={(event) => updateChipChoice(selected.id, event.target.value)}
              className="t-input min-h-[var(--control-md)] rounded-sm border border-border-strong bg-surface px-3 text-text"
            >
              <option value="AI">Let the model choose · GW {selected.gameweek}</option>
              {gameweekOptions(selected).map((gameweek) => (
                <option key={gameweek} value={gameweek}>
                  Lock to GW {gameweek}
                </option>
              ))}
            </select>
          </label>
          <p className="t-body-sm m-0 text-text-muted">{strategyMessage}</p>
        </Card>
      )}

      <Card className="flex flex-col gap-2">
        <CardHead
          eyebrow={`GW ${nextEvent} squad objective`}
          title={
            gw1Strategy === "bench-boost"
              ? "Maximise all fifteen"
              : gw1Strategy === "triple-captain"
                ? "Maximise the captain's ceiling"
                : "Maximise the starting eleven"
          }
          aside={
            <Chip tone={chipPlanValidation.valid ? "positive" : "negative"}>
              {chipPlanValidation.valid ? "Rules valid" : chipPlanValidation.issues[0]}
            </Chip>
          }
        />
        <p className="t-body m-0 text-text-muted">
          {gw1Strategy === "bench-boost"
            ? "Bench projections count in full, and the squad is judged across the next three gameweeks as well."
            : gw1Strategy === "triple-captain"
              ? "The captain carries an extra multiplier, and the bench is valued only as cover."
              : "The draft prioritises the best legal eleven and captain, with lower-weight bench cover."}{" "}
          Current projection {projectedGw1.toFixed(1)} pts.
        </p>
      </Card>

      <Card className="flex flex-col gap-2">
        <CardHead eyebrow="Regret-aware planning" title="What your locks do" />
        <p className="t-body m-0 text-text-muted">
          A locked chip is treated as a constraint, not ignored. The rest of the plan is rebuilt
          around it, and the squad objective for that gameweek changes with it.
        </p>
        <div className="flex flex-col">
          {[
            ["Locked by you", `${chipPlan.filter((item) => item.locked).length} of 8`],
            ["Still flexible", `${chipPlan.filter((item) => !item.locked).length} chips`],
            ["First Wildcard", `GW ${chipPlan.find((item) => item.id === "WC1")?.gameweek ?? "—"}`],
          ].map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-3 border-t border-border py-2"
            >
              <span className="t-body text-text-muted">{label}</span>
              <span className="t-data-lg">{value}</span>
            </div>
          ))}
        </div>
        {/*
          TODO: the design shows expected gain per gameweek for each chip. That
          needs a chip-value model — bench projections and fixture counts per
          future gameweek — which does not exist yet, so the plan shows the
          gameweek it has chosen and why rather than a chart of invented bars.
        */}
      </Card>

      <div className="fixed inset-x-0 bottom-[calc(var(--tab-bar)+env(safe-area-inset-bottom))] z-[var(--z-tabbar)] border-t border-border bg-header-glass p-3 backdrop-blur-md expanded:static expanded:border-0 expanded:bg-transparent expanded:p-0">
        <div className="mx-auto w-full max-w-[var(--content-max)]">
          <Button
            variant="primary"
            block
            disabled={!chipPlanValidation.valid}
            onClick={applyChipStrategy}
          >
            Apply plan and rebuild the squad
          </Button>
        </div>
      </div>
    </div>
  );
}
