import { describe, expect, it } from 'vitest';
import { listGroqTextModels } from '../../server/groq/models-base.js';
import { buildProbeMatrix } from '../../server/gemini/probe-matrix.js';
import { resolveTextModel, TEXT_MODEL_REGISTRY } from '../../server/gemini/models.js';

describe('Groq models registry', () => {
  it('registers all Groq text models with -off probe keys', () => {
    const groqIds = listGroqTextModels().map((m) => m.id);
    expect(groqIds).toContain('openai--gpt-oss-20b');
    expect(groqIds).toContain('llama-3.1-8b-instant');

    for (const id of groqIds) {
      const probeKey = `${id}-off`;
      expect(TEXT_MODEL_REGISTRY[probeKey]).toBeDefined();
      expect(TEXT_MODEL_REGISTRY[probeKey].provider).toBe('groq');
    }
  });

  it('resolves Groq api model id from slug alias', () => {
    const resolved = resolveTextModel('openai/gpt-oss-20b');
    expect(resolved.apiModelId).toBe('openai/gpt-oss-20b');
    expect(resolved.registryKey).toBe('openai--gpt-oss-20b-off');
    expect(resolved.info.provider).toBe('groq');
  });

  it('marks allam and compound models as not supporting function calling', () => {
    const allam = resolveTextModel('allam-2-7b-off');
    const compound = resolveTextModel('groq--compound-off');
    expect(allam.info.supportsFunctionCalling).toBe(false);
    expect(compound.info.supportsFunctionCalling).toBe(false);
  });

  it('does not register removed safeguard or orpheus models', () => {
    const ids = listGroqTextModels().map((m) => m.apiModelId);
    expect(ids.some((id) => id.includes('safeguard'))).toBe(false);
    expect(ids.some((id) => id.includes('orpheus'))).toBe(false);
  });

  it('tags compound with built-in web search and code execution', () => {
    const compound = resolveTextModel('groq--compound-off');
    expect(compound.info.supportsWebSearch).toBe(true);
    expect(compound.info.supportsCodeExecution).toBe(true);
    expect(compound.info.supportsStrictJson).toBe(false);
    expect(compound.info.speedTier).toBe('fast');
  });

  it('assigns compound-mini to instant and gpt-oss-120b to moderate', () => {
    expect(resolveTextModel('groq--compound-mini-off').info.speedTier).toBe('instant');
    expect(resolveTextModel('openai--gpt-oss-120b-off').info.speedTier).toBe('moderate');
  });

  it('tags gpt-oss models with strict JSON support', () => {
    const oss20 = resolveTextModel('openai--gpt-oss-20b-off');
    expect(oss20.info.supportsStrictJson).toBe(true);
    expect(oss20.info.supportsStructuredOutput).toBe(true);
  });

  it('tags gpt-oss models with code execution support', () => {
    const oss20 = resolveTextModel('openai--gpt-oss-20b-off');
    const oss120 = resolveTextModel('openai--gpt-oss-120b-off');
    expect(oss20.info.supportsCodeExecution).toBe(true);
    expect(oss120.info.supportsCodeExecution).toBe(true);
  });

  it('includes Groq probes in calibration matrix', () => {
    const groqProbeCount = listGroqTextModels().length;
    const groqProbes = buildProbeMatrix().filter((p) => p.provider === 'groq');
    expect(groqProbes).toHaveLength(groqProbeCount);
    expect(groqProbes.every((p) => p.bakedThinkingPower === 'off')).toBe(true);
  });
});
