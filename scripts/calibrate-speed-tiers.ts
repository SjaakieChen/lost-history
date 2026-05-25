import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { getGenAIClient } from '../server/gemini/client.js';
import {
  buildProbeMatrix,
  CALIBRATION_PROMPT,
  DEFAULT_CALIBRATION_RUNS,
} from '../server/gemini/probe-matrix.js';
import { buildThinkingConfig } from '../server/gemini/thinking.js';
import {
  BENCHMARK_JSON_PATH,
  CALIBRATION_DIR,
  p50,
  p95,
  type SpeedBenchmarkProbeResult,
  type SpeedBenchmarkReport,
} from '../server/gemini/speed-benchmark.js';
import { getGroqApiKey, requireAnyLlmApiKey } from '../server/config.js';
import { getGroqClient } from '../server/groq/client.js';

const runsPerProbe = Number(process.env.CALIBRATION_RUNS ?? DEFAULT_CALIBRATION_RUNS);

async function measureGroqProbe(apiModelId: string): Promise<{ ms: number; ok: boolean; error?: string }> {
  const started = performance.now();
  try {
    const client = getGroqClient();
    const response = await client.chat.completions.create({
      model: apiModelId,
      messages: [{ role: 'user', content: CALIBRATION_PROMPT }],
      max_tokens: 32,
    });
    const text = response.choices[0]?.message?.content?.trim() ?? '';
    if (!text) {
      return { ms: Math.round(performance.now() - started), ok: false, error: 'empty response' };
    }
    return { ms: Math.round(performance.now() - started), ok: true };
  } catch (error) {
    return {
      ms: Math.round(performance.now() - started),
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function measureProbe(
  apiModelId: string,
  thinkingMode: SpeedBenchmarkProbeResult['thinkingMode'],
  bakedThinkingPower: string,
  provider: 'gemini' | 'groq' = 'gemini',
): Promise<{ ms: number; ok: boolean; error?: string }> {
  if (provider === 'groq') {
    if (!getGroqApiKey()) {
      return { ms: 0, ok: false, error: 'GROQ_API_KEY not set' };
    }
    return measureGroqProbe(apiModelId);
  }

  const started = performance.now();
  try {
    const ai = getGenAIClient();
    const thinkingConfig = buildThinkingConfig(
      thinkingMode as 'none' | 'budget' | 'levels',
      bakedThinkingPower as 'off' | 'minimal' | 'low' | 'medium' | 'high',
      false,
    );

    const response = await ai.models.generateContent({
      model: apiModelId,
      contents: CALIBRATION_PROMPT,
      config: {
        thinkingConfig,
        maxOutputTokens: 32,
      },
    });

    const text = response.text?.trim() ?? '';
    if (!text) {
      return { ms: Math.round(performance.now() - started), ok: false, error: 'empty response' };
    }

    return { ms: Math.round(performance.now() - started), ok: true };
  } catch (error) {
    return {
      ms: Math.round(performance.now() - started),
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function renderMarkdown(report: SpeedBenchmarkReport): string {
  const lines = [
    '# Speed benchmark',
    '',
    `Generated: ${report.generatedAt}`,
    `Prompt: \`${report.prompt}\``,
    `Runs per probe: ${report.runsPerProbe}`,
    '',
    '| apiModelId | bakedThinking | thinkingMode | p50 ms | p95 ms | ok/total |',
    '|------------|---------------|--------------|--------|--------|----------|',
  ];

  const sorted = [...report.probes].sort((a, b) => (a.p50Ms ?? Infinity) - (b.p50Ms ?? Infinity));

  for (const probe of sorted) {
    const okCount = probe.runs.filter((run) => run.ok).length;
    lines.push(
      `| ${probe.apiModelId} | ${probe.bakedThinkingPower} | ${probe.thinkingMode} | ${probe.p50Ms ?? '—'} | ${probe.p95Ms ?? '—'} | ${okCount}/${probe.runs.length} |`,
    );
  }

  lines.push(
    '',
    'Set `SPEED_TIER_BOUNDS_MS` in `server/gemini/speed-tier-bounds.ts` from these results, then run `npm run assign:speed-tiers`.',
  );

  return lines.join('\n');
}

async function main(): Promise<void> {
  requireAnyLlmApiKey();
  const probes = buildProbeMatrix();
  const results: SpeedBenchmarkProbeResult[] = [];

  console.log(`Calibrating ${probes.length} probes (${runsPerProbe} runs each)…`);

  for (const probe of probes) {
    console.log(`\n→ ${probe.probeKey}`);
    const runs = [];

    for (let i = 0; i < runsPerProbe; i += 1) {
      const run = await measureProbe(
        probe.apiModelId,
        probe.thinkingMode,
        probe.bakedThinkingPower,
        probe.provider,
      );
      runs.push(run);
      console.log(`  run ${i + 1}: ${run.ok ? `${run.ms}ms` : `FAIL ${run.error}`}`);
      if (runsPerProbe > 1 && i < runsPerProbe - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    const okMs = runs.filter((run) => run.ok).map((run) => run.ms);
    results.push({
      probeKey: probe.probeKey,
      apiModelId: probe.apiModelId,
      bakedThinkingPower: probe.bakedThinkingPower,
      thinkingMode: probe.thinkingMode,
      runs,
      p50Ms: p50(okMs),
      p95Ms: p95(okMs),
    });
  }

  const report: SpeedBenchmarkReport = {
    generatedAt: new Date().toISOString(),
    prompt: CALIBRATION_PROMPT,
    runsPerProbe,
    probes: results,
  };

  mkdirSync(CALIBRATION_DIR, { recursive: true });
  writeFileSync(BENCHMARK_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(
    `${CALIBRATION_DIR}/speed-benchmark.md`,
    `${renderMarkdown(report)}\n`,
    'utf8',
  );

  console.log(`\nWrote ${BENCHMARK_JSON_PATH}`);
  console.log(`Wrote ${CALIBRATION_DIR}/speed-benchmark.md`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
