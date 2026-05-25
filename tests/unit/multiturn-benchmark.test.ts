import { describe, expect, it } from 'vitest';
import type { CallLlmAgentResult } from '../../shared/gemini-types.js';
import {
  aggregateMultiturnProbeRuns,
  buildFunctionCallingProbeMatrix,
  isMultiturnCalibrationSuccess,
  multiturnRunFromAgentResult,
  renderMultiturnMarkdown,
  stepDurationMs,
} from '../../server/gemini/multiturn-benchmark.js';

function agentResult(overrides: Partial<CallLlmAgentResult>): CallLlmAgentResult {
  return {
    text: 'OK',
    model: 'gemini-3.1-flash-lite-low',
    registryKey: 'gemini-3.1-flash-lite-low',
    terminationReason: 'final_tool',
    stepCount: 3,
    steps: [
      { step: 1, model: 'gemini-3.1-flash-lite-low', durationMs: 100 },
      { step: 2, model: 'gemini-3.1-flash-lite-low', durationMs: 200 },
      { step: 3, model: 'gemini-3.1-flash-lite-low', durationMs: 150 },
    ],
    modelsAttempted: ['gemini-3.1-flash-lite-low'],
    modelSelectedBy: 'explicit',
    ...overrides,
  } as CallLlmAgentResult;
}

describe('multiturn-benchmark', () => {
  it('isMultiturnCalibrationSuccess requires ordered tools and final OK answer', () => {
    expect(
      isMultiturnCalibrationSuccess(
        agentResult({
          steps: [
            {
              step: 1,
              model: 'gemini-3.1-flash-lite-low',
              toolResults: [{ name: 'fetch_piece', response: {} }],
            },
            {
              step: 2,
              model: 'gemini-3.1-flash-lite-low',
              toolResults: [{ name: 'combine_pieces', response: {} }],
            },
            { step: 3, model: 'gemini-3.1-flash-lite-low' },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      isMultiturnCalibrationSuccess(
        agentResult({
          stepCount: 1,
          terminationReason: 'final_tool',
          steps: [{ step: 1, model: 'gemini-3.1-flash-lite-low' }],
        }),
      ),
    ).toBe(false);
    expect(
      isMultiturnCalibrationSuccess(agentResult({ stepCount: 3, terminationReason: 'natural' })),
    ).toBe(false);
    expect(
      isMultiturnCalibrationSuccess(
        agentResult({
          text: 'NO',
          steps: [
            {
              step: 1,
              model: 'x',
              toolResults: [{ name: 'fetch_piece', response: {} }],
            },
            {
              step: 2,
              model: 'x',
              toolResults: [{ name: 'combine_pieces', response: {} }],
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  it('multiturnRunFromAgentResult extracts per-step durations', () => {
    const run = multiturnRunFromAgentResult(
      agentResult({
        steps: [
          {
            step: 1,
            model: 'gemini-3.1-flash-lite-low',
            durationMs: 100,
            toolResults: [{ name: 'fetch_piece', response: {} }],
          },
          {
            step: 2,
            model: 'gemini-3.1-flash-lite-low',
            durationMs: 200,
            toolResults: [{ name: 'combine_pieces', response: {} }],
          },
          { step: 3, model: 'gemini-3.1-flash-lite-low', durationMs: 150 },
        ],
      }),
      500,
    );
    expect(run.ok).toBe(true);
    expect(run.totalMs).toBe(500);
    expect(run.step1Ms).toBe(100);
    expect(run.step2Ms).toBe(200);
    expect(run.step3Ms).toBe(150);
    expect(run.error).toBeUndefined();
  });

  it('stepDurationMs returns undefined for missing step', () => {
    expect(stepDurationMs(agentResult({}).steps, 4)).toBeUndefined();
  });

  it('buildFunctionCallingProbeMatrix excludes non-tool models', () => {
    const probes = buildFunctionCallingProbeMatrix();
    expect(probes.length).toBeGreaterThan(0);
    expect(probes.every((probe) => probe.supportsFunctionCalling)).toBe(true);
    expect(probes.some((probe) => probe.probeKey.includes('orpheus'))).toBe(false);
  });

  it('aggregateMultiturnProbeRuns computes p50 from ok totals', () => {
    const agg = aggregateMultiturnProbeRuns([
      { totalMs: 300, stepCount: 3, ok: true },
      { totalMs: 500, stepCount: 3, ok: true },
      { totalMs: 900, stepCount: 1, ok: false },
    ]);
    expect(agg.p50TotalMs).toBe(500);
    expect(agg.p95TotalMs).toBe(500);
  });

  it('renderMultiturnMarkdown includes probe rows', () => {
    const md = renderMultiturnMarkdown({
      generatedAt: '2026-01-01T00:00:00.000Z',
      prompt: 'test',
      runsPerProbe: 1,
      probes: [
        {
          probeKey: 'gemini-3.1-flash-lite-low',
          apiModelId: 'gemini-3.1-flash-lite',
          bakedThinkingPower: 'minimal',
          thinkingMode: 'levels',
          runs: [
            {
              totalMs: 450,
              step1Ms: 100,
              step2Ms: 200,
              step3Ms: 150,
              stepCount: 3,
              ok: true,
            },
          ],
          p50TotalMs: 450,
          p95TotalMs: 450,
        },
      ],
    });
    expect(md).toContain('gemini-3.1-flash-lite');
    expect(md).toContain('450');
    expect(md).toContain('1/1');
  });
});
