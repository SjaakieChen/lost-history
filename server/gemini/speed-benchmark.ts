import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface SpeedBenchmarkRun {
  ms: number;
  ok: boolean;
  error?: string;
}

export interface SpeedBenchmarkProbeResult {
  probeKey: string;
  apiModelId: string;
  bakedThinkingPower: string;
  thinkingMode: string;
  runs: SpeedBenchmarkRun[];
  p50Ms?: number;
  p95Ms?: number;
}

export interface SpeedBenchmarkReport {
  generatedAt: string;
  prompt: string;
  runsPerProbe: number;
  probes: SpeedBenchmarkProbeResult[];
}

export const CALIBRATION_DIR = join(process.cwd(), 'calibration');
export const BENCHMARK_JSON_PATH = join(CALIBRATION_DIR, 'speed-benchmark.json');

export function loadSpeedBenchmarkReport(): SpeedBenchmarkReport | null {
  if (!existsSync(BENCHMARK_JSON_PATH)) {
    return null;
  }
  const raw = readFileSync(BENCHMARK_JSON_PATH, 'utf8');
  return JSON.parse(raw) as SpeedBenchmarkReport;
}

export function p50(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function p95(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

export function buildBenchmarkLookup(
  report: SpeedBenchmarkReport | null,
): Map<string, number> {
  const map = new Map<string, number>();
  if (!report) {
    return map;
  }
  for (const probe of report.probes) {
    if (probe.p50Ms !== undefined) {
      map.set(probe.probeKey, probe.p50Ms);
    }
  }
  return map;
}
