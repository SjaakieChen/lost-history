import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { buildProbeMatrix } from '../server/gemini/probe-matrix.js';
import {
  BENCHMARK_JSON_PATH,
  loadSpeedBenchmarkReport,
} from '../server/gemini/speed-benchmark.js';
import {
  areSpeedTierBoundsConfigured,
  getSpeedTierBounds,
} from '../server/gemini/speed-tier-bounds.js';
import { classifyP50ToSpeedTier } from '../server/gemini/speed-tier-classify.js';

function main(): void {
  if (!areSpeedTierBoundsConfigured()) {
    console.error(
      'SPEED_TIER_BOUNDS_MS is null. Set thresholds in server/gemini/speed-tier-bounds.ts after reviewing calibration output.',
    );
    process.exit(1);
  }

  const report = loadSpeedBenchmarkReport();
  if (!report) {
    console.error(`Missing benchmark file: ${BENCHMARK_JSON_PATH}. Run npm run calibrate:speed first.`);
    process.exit(1);
  }

  const bounds = getSpeedTierBounds();
  const probes = buildProbeMatrix();
  const p50ByKey = new Map(report.probes.map((probe) => [probe.probeKey, probe.p50Ms]));

  const assignments: Array<{
    probeKey: string;
    apiModelId: string;
    bakedThinkingPower: string;
    p50Ms?: number;
    speedTier: string | null;
  }> = [];

  for (const probe of probes) {
    const p50Ms = p50ByKey.get(probe.probeKey);
    const speedTier =
      p50Ms !== undefined ? classifyP50ToSpeedTier(p50Ms, bounds) : null;
    assignments.push({
      probeKey: probe.probeKey,
      apiModelId: probe.apiModelId,
      bakedThinkingPower: probe.bakedThinkingPower,
      p50Ms,
      speedTier,
    });
  }

  const byTier: Record<string, string[]> = {
    instant: [],
    fast: [],
    moderate: [],
    slow: [],
    unclassified: [],
  };

  for (const row of assignments) {
    const bucket = row.speedTier ?? 'unclassified';
    byTier[bucket].push(row.probeKey);
  }

  for (const tier of Object.keys(byTier)) {
    byTier[tier].sort((a, b) => {
      const p50A = p50ByKey.get(a) ?? Infinity;
      const p50B = p50ByKey.get(b) ?? Infinity;
      return p50A - p50B;
    });
  }

  const output = {
    bounds,
    assignments,
    speedTierModelOrder: {
      instant: byTier.instant,
      fast: byTier.fast,
      moderate: byTier.moderate,
      slow: byTier.slow,
    },
    unclassified: byTier.unclassified,
  };

  const outPath = 'calibration/speed-tier-assignments.json';
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log(`Wrote ${outPath}\n`);
  console.log('Suggested SPEED_TIER_MODEL_ORDER (fastest first within tier):');
  console.log(JSON.stringify(output.speedTierModelOrder, null, 2));

  if (byTier.unclassified.length > 0) {
    console.warn(
      `\n${byTier.unclassified.length} probe(s) did not match any bucket — widen bounds or add a tier.`,
    );
  }
}

main();
