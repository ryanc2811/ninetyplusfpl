/**
 * Benchmark comparison.
 *
 * Three players compared by eye cannot tell you whether a model is biased. A
 * gap that looks like a per-player problem is usually a systematic one: the
 * bias that prompted this module was invisible per player but obvious once
 * residuals were grouped by projection size, because it grew with the
 * projection rather than being a constant offset.
 *
 * Benchmarks are **evaluation data, not model input**. Nothing under `lib/`
 * that produces a projection may import this module, and a test enforces that.
 * Fitting projections to a competitor's numbers would replace a measurable
 * model with an unmeasurable copy of someone else's.
 */

export type BenchmarkEntry = {
  /** FPL `web_name`, which is what the projection is keyed by. */
  player: string;
  team: string;
  /** The reference source's projection for the same Gameweek. */
  projected: number;
};

export type BenchmarkSet = {
  source: string;
  gameweek: number;
  capturedAt: string;
  entries: BenchmarkEntry[];
};

export type Residual = {
  player: string;
  ours: number;
  reference: number;
  /** Positive means this model projects higher than the reference. */
  difference: number;
};

export type BenchmarkBand = {
  label: string;
  lower: number;
  upper: number;
  count: number;
  meanDifference: number;
  meanAbsoluteDifference: number;
};

export type BenchmarkReport = {
  source: string;
  gameweek: number;
  matched: number;
  missing: string[];
  /** Mean signed difference. Non-zero means systematic bias. */
  bias: number;
  meanAbsoluteError: number;
  /** Slope of difference against reference value. Non-zero means the bias
   *  scales with projection size, which a constant offset cannot fix. */
  biasSlope: number;
  bands: BenchmarkBand[];
  residuals: Residual[];
};

const BANDS: Array<{ label: string; lower: number; upper: number }> = [
  { label: "under 3", lower: -Infinity, upper: 3 },
  { label: "3 to 4.5", lower: 3, upper: 4.5 },
  { label: "4.5 to 6", lower: 4.5, upper: 6 },
  { label: "6 and above", lower: 6, upper: Infinity },
];

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Ordinary least squares slope of y on x. */
function slope(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return 0;
  const meanX = mean(points.map((point) => point.x));
  const meanY = mean(points.map((point) => point.y));
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.x - meanX) * (point.y - meanY);
    denominator += (point.x - meanX) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

export function compareToBenchmark(
  projections: Array<{ name: string; team: string; xp1: number }>,
  benchmark: BenchmarkSet,
): BenchmarkReport {
  const byName = new Map(
    projections.map((projection) => [`${projection.name}|${projection.team}`, projection]),
  );
  const residuals: Residual[] = [];
  const missing: string[] = [];

  for (const entry of benchmark.entries) {
    const match = byName.get(`${entry.player}|${entry.team}`)
      ?? projections.find((projection) => projection.name === entry.player);
    if (!match) {
      missing.push(entry.player);
      continue;
    }
    residuals.push({
      player: entry.player,
      ours: match.xp1,
      reference: entry.projected,
      difference: Number((match.xp1 - entry.projected).toFixed(3)),
    });
  }

  const differences = residuals.map((residual) => residual.difference);
  const bands = BANDS.map((band) => {
    const inBand = residuals.filter(
      (residual) => residual.reference >= band.lower && residual.reference < band.upper,
    );
    return {
      label: band.label,
      lower: band.lower,
      upper: band.upper,
      count: inBand.length,
      meanDifference: Number(mean(inBand.map((r) => r.difference)).toFixed(3)),
      meanAbsoluteDifference: Number(
        mean(inBand.map((r) => Math.abs(r.difference))).toFixed(3),
      ),
    };
  });

  return {
    source: benchmark.source,
    gameweek: benchmark.gameweek,
    matched: residuals.length,
    missing,
    bias: Number(mean(differences).toFixed(3)),
    meanAbsoluteError: Number(mean(differences.map(Math.abs)).toFixed(3)),
    biasSlope: Number(
      slope(residuals.map((r) => ({ x: r.reference, y: r.difference }))).toFixed(4),
    ),
    bands,
    residuals: residuals.sort((a, b) => b.reference - a.reference),
  };
}

/** Renders a report as plain text for a terminal or a CI log. */
export function formatBenchmarkReport(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push(`Benchmark: ${report.source} · GW${report.gameweek}`);
  lines.push(`Matched ${report.matched} players` + (report.missing.length ? ` (unmatched: ${report.missing.join(", ")})` : ""));
  lines.push("");
  lines.push(`  bias (mean signed)      ${report.bias >= 0 ? "+" : ""}${report.bias.toFixed(2)}`);
  lines.push(`  mean absolute error     ${report.meanAbsoluteError.toFixed(2)}`);
  lines.push(`  bias slope vs size      ${report.biasSlope >= 0 ? "+" : ""}${report.biasSlope.toFixed(3)}  (0 = bias does not scale with projection)`);
  lines.push("");
  lines.push("  By reference projection:");
  for (const band of report.bands) {
    if (!band.count) continue;
    lines.push(
      `    ${band.label.padEnd(12)} n=${String(band.count).padStart(3)}  `
      + `bias ${band.meanDifference >= 0 ? "+" : ""}${band.meanDifference.toFixed(2)}  `
      + `mae ${band.meanAbsoluteDifference.toFixed(2)}`,
    );
  }
  lines.push("");
  lines.push("  Largest residuals:");
  const worst = [...report.residuals].sort(
    (a, b) => Math.abs(b.difference) - Math.abs(a.difference),
  );
  for (const residual of worst.slice(0, 10)) {
    lines.push(
      `    ${residual.player.padEnd(16)} ours ${residual.ours.toFixed(1).padStart(5)}  `
      + `ref ${residual.reference.toFixed(1).padStart(5)}  `
      + `${residual.difference >= 0 ? "+" : ""}${residual.difference.toFixed(2)}`,
    );
  }
  return lines.join("\n");
}
