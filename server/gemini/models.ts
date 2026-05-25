import type {
  GetModelsByTierOptions,
  SpeedTier,
  TextModelInfo,
  ThinkingModeKind,
} from '../../shared/gemini-types.js';
import { buildBenchmarkLookup, loadSpeedBenchmarkReport } from './speed-benchmark.js';
import { buildProbeMatrix } from './probe-matrix.js';
import { inferGroqSpeedTier } from '../groq/models-base.js';
import {
  inferSpeedTierFromModelId,
  inferThinkingMode,
  listTextModels as listBaseTextModels,
} from './models-base.js';
import { resolveProbeSpeedTier } from './speed-tier-classify.js';

function buildRegistry(): Record<string, TextModelInfo> {
  const benchmark = loadSpeedBenchmarkReport();
  const p50ByProbe = buildBenchmarkLookup(benchmark);
  const probes = buildProbeMatrix();
  const registry: Record<string, TextModelInfo> = {};

  for (const probe of probes) {
    const p50Ms = p50ByProbe.get(probe.probeKey);
    const speedTier = resolveProbeSpeedTier(p50Ms, probe.bakedThinkingPower);

    registry[probe.probeKey] = {
      id: probe.probeKey,
      apiModelId: probe.apiModelId,
      displayName: probe.displayName,
      category: 'text',
      provider: probe.provider,
      speedTier,
      bakedThinkingPower: probe.bakedThinkingPower,
      supportsThinking: probe.supportsThinking,
      thinkingMode: probe.thinkingMode,
      supportsFunctionCalling: probe.supportsFunctionCalling,
      supportsStructuredOutput: probe.supportsStructuredOutput,
      freeTierAvailable: probe.freeTierAvailable,
      rateLimitHints: probe.rateLimitHints,
      aliases: probe.aliases,
    };
  }

  const order = buildSpeedTierModelOrder(registry, p50ByProbe);
  return attachStrengthRanks(registry, order);
}

function attachStrengthRanks(
  registry: Record<string, TextModelInfo>,
  order: Record<SpeedTier, string[]>,
): Record<string, TextModelInfo> {
  const result: Record<string, TextModelInfo> = {};

  for (const [id, model] of Object.entries(registry)) {
    const tierOrder = order[model.speedTier];
    const rank = tierOrder.indexOf(id);
    result[id] = {
      ...model,
      strengthRank: rank >= 0 ? rank + 1 : undefined,
    };
  }

  return result;
}

export function buildSpeedTierModelOrder(
  registry: Record<string, TextModelInfo>,
  p50ByProbe: Map<string, number> = buildBenchmarkLookup(loadSpeedBenchmarkReport()),
): Record<SpeedTier, string[]> {
  const tiers: Record<SpeedTier, string[]> = {
    instant: [],
    fast: [],
    moderate: [],
    slow: [],
  };

  for (const model of Object.values(registry)) {
    tiers[model.speedTier].push(model.id);
  }

  const baseStrength = listBaseTextModels().map((model) => model.id);

  for (const tier of Object.keys(tiers) as SpeedTier[]) {
    tiers[tier].sort((a, b) => {
      const p50A = p50ByProbe.get(a);
      const p50B = p50ByProbe.get(b);
      if (p50A !== undefined && p50B !== undefined && p50A !== p50B) {
        return p50A - p50B;
      }
      const baseA = baseStrength.indexOf(a.replace(/-(minimal|low|medium|high|off)$/, ''));
      const baseB = baseStrength.indexOf(b.replace(/-(minimal|low|medium|high|off)$/, ''));
      if (baseA !== -1 && baseB !== -1 && baseA !== baseB) {
        return baseA - baseB;
      }
      return a.localeCompare(b);
    });
  }

  return tiers;
}

const BENCHMARK_LOOKUP = buildBenchmarkLookup(loadSpeedBenchmarkReport());
const REGISTRY_WITHOUT_RANKS = (() => {
  const benchmark = loadSpeedBenchmarkReport();
  const p50ByProbe = buildBenchmarkLookup(benchmark);
  const probes = buildProbeMatrix();
  const registry: Record<string, TextModelInfo> = {};
  for (const probe of probes) {
    const p50Ms = p50ByProbe.get(probe.probeKey);
    const speedTier = resolveProbeSpeedTier(p50Ms, probe.bakedThinkingPower);
    registry[probe.probeKey] = {
      id: probe.probeKey,
      apiModelId: probe.apiModelId,
      displayName: probe.displayName,
      category: 'text',
      provider: probe.provider,
      speedTier,
      bakedThinkingPower: probe.bakedThinkingPower,
      supportsThinking: probe.supportsThinking,
      thinkingMode: probe.thinkingMode,
      supportsFunctionCalling: probe.supportsFunctionCalling,
      supportsStructuredOutput: probe.supportsStructuredOutput,
      freeTierAvailable: probe.freeTierAvailable,
      rateLimitHints: probe.rateLimitHints,
      aliases: probe.aliases,
    };
  }
  return registry;
})();

export const SPEED_TIER_MODEL_ORDER: Record<SpeedTier, string[]> = buildSpeedTierModelOrder(
  REGISTRY_WITHOUT_RANKS,
  BENCHMARK_LOOKUP,
);

export const TEXT_MODEL_REGISTRY: Record<string, TextModelInfo> = attachStrengthRanks(
  REGISTRY_WITHOUT_RANKS,
  SPEED_TIER_MODEL_ORDER,
);

const ALIAS_INDEX = buildAliasIndex(TEXT_MODEL_REGISTRY);

function buildAliasIndex(registry: Record<string, TextModelInfo>): Map<string, TextModelInfo> {
  const index = new Map<string, TextModelInfo>();

  for (const model of Object.values(registry)) {
    index.set(model.id, model);
    for (const alias of model.aliases ?? []) {
      index.set(alias, model);
    }
  }

  return index;
}

export interface ResolvedTextModel {
  registryKey: string;
  apiModelId: string;
  info: TextModelInfo;
  tier: SpeedTier;
}

export type LlmCapability = 'functionCalling' | 'structuredOutput' | 'thinking';

export class LlmCapabilityError extends Error {
  readonly model: string;
  readonly capability: LlmCapability;

  constructor(message: string, model: string, capability: LlmCapability) {
    super(message);
    this.name = 'LlmCapabilityError';
    this.model = model;
    this.capability = capability;
  }
}

export function assertCapability(info: TextModelInfo, capability: LlmCapability): void {
  const checks: Record<LlmCapability, boolean> = {
    functionCalling: info.supportsFunctionCalling,
    structuredOutput: info.supportsStructuredOutput,
    thinking: info.supportsThinking,
  };

  if (!checks[capability]) {
    throw new LlmCapabilityError(
      `Model "${info.id}" does not support ${capability}.`,
      info.id,
      capability,
    );
  }
}

export function resolveTextModel(model?: string): ResolvedTextModel {
  const requested = model?.trim();

  if (!requested) {
    throw new Error('Model id is required.');
  }

  const info = ALIAS_INDEX.get(requested);

  if (info) {
    if (info.category !== 'text') {
      throw new Error(`Model "${requested}" is not a text model.`);
    }
    return {
      registryKey: info.id,
      apiModelId: info.apiModelId,
      info,
      tier: info.speedTier,
    };
  }

  const isGroq =
    requested.includes('/') ||
    /--/.test(requested) ||
    /^(allam-|llama-|groq\/|openai\/|qwen\/|meta-llama\/)/.test(requested);
  const apiModelId = isGroq && /--/.test(requested)
    ? requested.replace(/--/g, '/')
    : requested;
  const thinkingMode = isGroq ? 'none' : inferThinkingMode(requested);
  const speedTier = isGroq ? inferGroqSpeedTier(requested) : inferSpeedTierFromModelId(requested);

  return {
    registryKey: requested,
    apiModelId,
    tier: speedTier,
    info: {
      id: requested,
      apiModelId,
      displayName: requested,
      category: 'text',
      provider: isGroq ? 'groq' : 'gemini',
      speedTier,
      bakedThinkingPower: isGroq ? 'off' : 'medium',
      supportsThinking: !isGroq && thinkingMode !== 'none',
      thinkingMode,
      supportsFunctionCalling: isGroq ? false : true,
      supportsStructuredOutput: isGroq ? false : /gemini-3/.test(requested),
      freeTierAvailable: true,
    },
  };
}

function filterModelsByOptions(
  models: TextModelInfo[],
  options?: GetModelsByTierOptions,
): TextModelInfo[] {
  const preferFreeTier = options?.preferFreeTier ?? true;

  return models.filter((model) => {
    if (preferFreeTier && !model.freeTierAvailable) {
      return false;
    }
    if (options?.requireFunctionCalling && !model.supportsFunctionCalling) {
      return false;
    }
    if (options?.requireStructuredOutput && !model.supportsStructuredOutput) {
      return false;
    }
    return true;
  });
}

export function getModelsBySpeedTier(
  tier: SpeedTier,
  options?: GetModelsByTierOptions,
): TextModelInfo[] {
  const priority = SPEED_TIER_MODEL_ORDER[tier];
  const byTier = Object.values(TEXT_MODEL_REGISTRY).filter((model) => model.speedTier === tier);

  const sorted = byTier.sort((a, b) => priority.indexOf(a.id) - priority.indexOf(b.id));

  return filterModelsByOptions(sorted, options);
}

export function resolveModelForSpeedTier(
  tier: SpeedTier,
  preferFreeTier = true,
): ResolvedTextModel {
  const models = getModelsBySpeedTier(tier, { preferFreeTier });

  if (models.length === 0) {
    const allInTier = getModelsBySpeedTier(tier, { preferFreeTier: false });
    if (allInTier.length === 0) {
      throw new Error(`No models registered for speed tier "${tier}".`);
    }
    const chosen = allInTier[0];
    return {
      registryKey: chosen.id,
      apiModelId: chosen.apiModelId,
      info: chosen,
      tier,
    };
  }

  const chosen = models[0];

  return {
    registryKey: chosen.id,
    apiModelId: chosen.apiModelId,
    info: chosen,
    tier,
  };
}

export function listTextModels(): TextModelInfo[] {
  return Object.values(TEXT_MODEL_REGISTRY).filter((model) => model.category === 'text');
}

export function listBaseTextModelIds(): string[] {
  return listBaseTextModels().map((model) => model.id);
}

export function getDefaultModelId(): string {
  const fromEnv = process.env.GEMINI_DEFAULT_MODEL?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  if (TEXT_MODEL_REGISTRY['gemini-3.1-flash-lite-minimal']) {
    return 'gemini-3.1-flash-lite-minimal';
  }
  return SPEED_TIER_MODEL_ORDER.instant[0] ?? 'gemini-3.1-flash-lite-minimal';
}

export function getDefaultSpeedTier(): SpeedTier {
  const defaultModel = getDefaultModelId();
  const resolved = resolveTextModel(defaultModel);
  return resolved.tier;
}
