import { join } from 'node:path';
import type { CallLlmAgentResult } from '../../shared/gemini-types.js';
import {
  FINAL_ANSWER_TOOL_NAME,
  MULTITURN_CALIBRATION_TOOLS,
} from '../llm/tool-schema.js';
import { buildProbeMatrix, type SpeedProbe } from './probe-matrix.js';
import { CALIBRATION_DIR, p50, p95 } from './speed-benchmark.js';

export { MULTITURN_CALIBRATION_TOOLS } from '../llm/tool-schema.js';

export interface MultiturnBenchmarkRun {
  totalMs: number;
  step1Ms?: number;
  step2Ms?: number;
  step3Ms?: number;
  stepCount: number;
  ok: boolean;
  error?: string;
}

export interface MultiturnBenchmarkProbeResult {
  probeKey: string;
  apiModelId: string;
  bakedThinkingPower: string;
  thinkingMode: string;
  runs: MultiturnBenchmarkRun[];
  p50TotalMs?: number;
  p95TotalMs?: number;
}

export interface MultiturnBenchmarkReport {
  generatedAt: string;
  prompt: string;
  runsPerProbe: number;
  probes: MultiturnBenchmarkProbeResult[];
}

export const MULTITURN_BENCHMARK_JSON_PATH = join(CALIBRATION_DIR, 'multiturn-benchmark.json');

export const MULTITURN_CALIBRATION_PROMPT =
  'You must complete this task using tools only, one tool per turn, in this exact order: ' +
  '1) fetch_piece with id "A", ' +
  '2) combine_pieces with pieces ["A","B"], ' +
  '3) submit_final_answer with answer "OK". ' +
  'Call exactly one tool per turn. Never call submit_final_answer before the first two tools. ' +
  'Do not reply with plain text.';

export const MULTITURN_CALIBRATION_TOOL_SEQUENCE = [
  'fetch_piece',
  'combine_pieces',
  FINAL_ANSWER_TOOL_NAME,
] as const;

export const MULTITURN_TOOL_HANDLERS = {
  fetch_piece: async () => ({ piece: 'A' }),
  combine_pieces: async () => ({ combined: 'AB' }),
};

export function buildFunctionCallingProbeMatrix(): SpeedProbe[] {
  const providerFilter = process.env.CALIBRATE_PROVIDER?.trim().toLowerCase();
  const includePaid =
    process.env.CALIBRATE_INCLUDE_PAID === '1' || process.env.CALIBRATE_INCLUDE_PAID === 'true';
  return buildProbeMatrix().filter((probe) => {
    if (!probe.supportsFunctionCalling) {
      return false;
    }
    if (!includePaid && !probe.freeTierAvailable) {
      return false;
    }
    if (providerFilter === 'gemini' || providerFilter === 'groq') {
      return probe.provider === providerFilter;
    }
    return true;
  });
}

export function calibrationToolsExecuted(result: CallLlmAgentResult): string[] {
  return result.steps.flatMap((step) => (step.toolResults ?? []).map((tool) => tool.name));
}

export function isMultiturnCalibrationSuccess(result: CallLlmAgentResult): boolean {
  if (result.terminationReason !== 'final_tool' || result.text.trim() !== 'OK') {
    return false;
  }
  const executed = calibrationToolsExecuted(result);
  return executed[0] === 'fetch_piece' && executed[1] === 'combine_pieces';
}

export function stepDurationMs(
  steps: CallLlmAgentResult['steps'],
  stepNumber: number,
): number | undefined {
  return steps.find((step) => step.step === stepNumber)?.durationMs;
}

export function multiturnRunFromAgentResult(
  result: CallLlmAgentResult,
  totalMs: number,
): MultiturnBenchmarkRun {
  const ok = isMultiturnCalibrationSuccess(result);
  return {
    totalMs,
    step1Ms: stepDurationMs(result.steps, 1),
    step2Ms: stepDurationMs(result.steps, 2),
    step3Ms: stepDurationMs(result.steps, 3),
    stepCount: result.stepCount,
    ok,
    error: ok
      ? undefined
      : `stepCount=${result.stepCount}, termination=${result.terminationReason}, tools=${calibrationToolsExecuted(result).join('→') || 'none'}`,
  };
}

export function renderMultiturnMarkdown(report: MultiturnBenchmarkReport): string {
  const lines = [
    '# Multi-turn benchmark (3-step tool loop)',
    '',
    `Generated: ${report.generatedAt}`,
    `Prompt: \`${report.prompt}\``,
    `Runs per probe: ${report.runsPerProbe}`,
    '',
    '| apiModelId | bakedThinking | total p50 ms | step1 | step2 | step3 | ok/total |',
    '|------------|---------------|--------------|-------|-------|-------|----------|',
  ];

  const sorted = [...report.probes].sort(
    (a, b) => (a.p50TotalMs ?? Infinity) - (b.p50TotalMs ?? Infinity),
  );

  for (const probe of sorted) {
    const okCount = probe.runs.filter((run) => run.ok).length;
    const lastOk = probe.runs.find((run) => run.ok);
    lines.push(
      `| ${probe.apiModelId} | ${probe.bakedThinkingPower} | ${probe.p50TotalMs ?? '—'} | ${lastOk?.step1Ms ?? '—'} | ${lastOk?.step2Ms ?? '—'} | ${lastOk?.step3Ms ?? '—'} | ${okCount}/${probe.runs.length} |`,
    );
  }

  return lines.join('\n');
}

export function aggregateMultiturnProbeRuns(
  runs: MultiturnBenchmarkRun[],
): Pick<MultiturnBenchmarkProbeResult, 'runs' | 'p50TotalMs' | 'p95TotalMs'> {
  const okTotals = runs.filter((run) => run.ok).map((run) => run.totalMs);
  return {
    runs,
    p50TotalMs: p50(okTotals),
    p95TotalMs: p95(okTotals),
  };
}
