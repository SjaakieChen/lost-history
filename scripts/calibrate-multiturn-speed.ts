import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { callLlmAgent } from '../server/gemini/call-llm-agent.js';
import {
  aggregateMultiturnProbeRuns,
  buildFunctionCallingProbeMatrix,
  MULTITURN_BENCHMARK_JSON_PATH,
  MULTITURN_CALIBRATION_PROMPT,
  MULTITURN_CALIBRATION_TOOLS,
  MULTITURN_CALIBRATION_TOOL_SEQUENCE,
  MULTITURN_TOOL_HANDLERS,
  multiturnRunFromAgentResult,
  renderMultiturnMarkdown,
  type MultiturnBenchmarkProbeResult,
  type MultiturnBenchmarkReport,
} from '../server/gemini/multiturn-benchmark.js';
import { CALIBRATION_DIR } from '../server/gemini/speed-benchmark.js';
import { DEFAULT_CALIBRATION_RUNS } from '../server/gemini/probe-matrix.js';
import { requireAnyLlmApiKey } from '../server/config.js';

const runsPerProbe = Number(process.env.CALIBRATION_RUNS ?? DEFAULT_CALIBRATION_RUNS);

function truncateError(message: string, maxLen = 200): string {
  if (message.length <= maxLen) {
    return message;
  }
  return `${message.slice(0, maxLen)}…`;
}

async function measureMultiturnProbe(probeKey: string): Promise<ReturnType<typeof multiturnRunFromAgentResult>> {
  const started = performance.now();
  try {
    const result = await callLlmAgent({
      model: probeKey,
      prompt: MULTITURN_CALIBRATION_PROMPT,
      tools: MULTITURN_CALIBRATION_TOOLS,
      toolHandlers: MULTITURN_TOOL_HANDLERS,
      toolSequence: [...MULTITURN_CALIBRATION_TOOL_SEQUENCE],
      functionCallingMode: 'ANY',
      termination: 'final_tool_only',
      maxSteps: 6,
    });
    return multiturnRunFromAgentResult(result, Math.round(performance.now() - started));
  } catch (error) {
    return {
      totalMs: Math.round(performance.now() - started),
      stepCount: 0,
      ok: false,
      error: truncateError(error instanceof Error ? error.message : String(error)),
    };
  }
}

async function main(): Promise<void> {
  requireAnyLlmApiKey();
  const probes = buildFunctionCallingProbeMatrix();
  const results: MultiturnBenchmarkProbeResult[] = [];

  console.log(
    `Multi-turn calibrating ${probes.length} probes (${runsPerProbe} run(s) each, 3 LLM turns per run)…`,
  );

  for (const probe of probes) {
    console.log(`\n→ ${probe.probeKey}`);
    const runs = [];

    for (let i = 0; i < runsPerProbe; i += 1) {
      const run = await measureMultiturnProbe(probe.probeKey);
      runs.push(run);
      console.log(
        `  run ${i + 1}: ${run.ok ? `${run.totalMs}ms (${run.step1Ms}/${run.step2Ms}/${run.step3Ms} per step)` : `FAIL ${run.error}`}`,
      );
      if (runsPerProbe > 1 && i < runsPerProbe - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    results.push({
      probeKey: probe.probeKey,
      apiModelId: probe.apiModelId,
      bakedThinkingPower: probe.bakedThinkingPower,
      thinkingMode: probe.thinkingMode,
      ...aggregateMultiturnProbeRuns(runs),
    });
  }

  const report: MultiturnBenchmarkReport = {
    generatedAt: new Date().toISOString(),
    prompt: MULTITURN_CALIBRATION_PROMPT,
    runsPerProbe,
    probes: results,
  };

  mkdirSync(CALIBRATION_DIR, { recursive: true });
  writeFileSync(MULTITURN_BENCHMARK_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(
    `${CALIBRATION_DIR}/multiturn-benchmark.md`,
    `${renderMultiturnMarkdown(report)}\n`,
    'utf8',
  );

  console.log(`\nWrote ${MULTITURN_BENCHMARK_JSON_PATH}`);
  console.log(`Wrote ${CALIBRATION_DIR}/multiturn-benchmark.md`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
