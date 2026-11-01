"use client";

import type { MonthlyResult } from "../../../lib/contracts/leagues";
import { firstName } from "./format";

const WIDTH = 420;
const HEIGHT = 240;
const PADDING = { top: 16, right: 96, bottom: 28, left: 40 };

/**
 * Cumulative net points through the month for the managers still in it.
 *
 * Lines are labelled at their end rather than in a key, so the chart does not
 * ask anyone to tell four similar colours apart.
 */
export function RaceChart({
  result,
  youEntryId,
  managers = 4,
}: {
  result: MonthlyResult;
  youEntryId: number | null;
  managers?: number;
}) {
  const events = [
    ...new Set(result.standings.flatMap((row) => row.gameweeks.map((week) => week.event))),
  ].sort((a, b) => a - b);
  if (events.length < 2) return null;

  const series = result.standings.slice(0, managers).map((row) => {
    let running = 0;
    const byEvent = new Map(row.gameweeks.map((week) => [week.event, week.netPoints]));
    const points = events.map((event) => {
      running += byEvent.get(event) ?? 0;
      return running;
    });
    return {
      entryId: row.entryId,
      label: row.entryId === youEntryId ? "You" : firstName(row.managerName),
      total: running,
      points,
      you: row.entryId === youEntryId,
    };
  });

  const max = Math.max(...series.flatMap((line) => line.points), 1);
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const x = (index: number) =>
    PADDING.left + (events.length === 1 ? plotWidth / 2 : (index / (events.length - 1)) * plotWidth);
  const y = (value: number) => PADDING.top + plotHeight - (value / max) * plotHeight;

  const gridValues = [0, 0.5, 1].map((share) => Math.round(max * share));

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Cumulative ${result.month.name} net points by gameweek. ${series
        .map((line) => `${line.label} ${line.total}`)
        .join(", ")}.`}
    >
      {gridValues.map((value) => (
        <g key={value}>
          <line
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={y(value)}
            y2={y(value)}
            stroke="var(--border)"
          />
          <text
            x={PADDING.left - 8}
            y={y(value) + 4}
            textAnchor="end"
            fontSize="12"
            fill="var(--text-muted)"
            fontFamily="var(--mono)"
          >
            {value}
          </text>
        </g>
      ))}

      {events.map((event, index) => (
        <text
          key={event}
          x={x(index)}
          y={HEIGHT - 8}
          textAnchor="middle"
          fontSize="12"
          fill="var(--text-muted)"
          fontFamily="var(--mono)"
        >
          GW{event}
        </text>
      ))}

      {series.map((line, lineIndex) => (
        <g key={line.entryId}>
          <polyline
            fill="none"
            stroke={line.you ? "var(--positive)" : "var(--border-strong)"}
            strokeWidth={line.you ? 2.5 : 1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={line.points.map((value, index) => `${x(index)},${y(value)}`).join(" ")}
          />
          <circle
            cx={x(events.length - 1)}
            cy={y(line.total)}
            r={line.you ? 4 : 3}
            fill={line.you ? "var(--positive)" : "var(--border-strong)"}
          />
          <text
            x={WIDTH - PADDING.right + 10}
            y={PADDING.top + 12 + lineIndex * 18}
            fontSize="12"
            fontWeight="600"
            fill={line.you ? "var(--positive)" : "var(--text-muted)"}
            fontFamily="var(--mono)"
          >
            {line.label} {line.total}
          </text>
        </g>
      ))}
    </svg>
  );
}
