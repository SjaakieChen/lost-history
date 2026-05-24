import type {
  GetModelsByTierOptions,
  TextModelInfo,
  ThinkingModeKind,
  ThinkingPowerTier,
} from '../../shared/gemini-types.js';

/** Strongest-first order within each tier (index 0 = rank 1). */
export const TIER_MODEL_STRENGTH_ORDER: Record<ThinkingPowerTier, string[]> = {
  low: ['gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite'],
  medium: ['gemini-3.5-flash', 'gemini-3-flash', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  high: ['gemini-3.1-pro', 'gemini-2.5-pro'],
};

/** @deprecated Use TIER_MODEL_STRENGTH_ORDER */
export const TIER_MODEL_PRIORITY = TIER_MODEL_STRENGTH_ORDER;

const BASE_REGISTRY: Record<string, Omit<TextModelInfo, 'strengthRank'>> = {
  'gemini-2.0-flash-lite': {
    id: 'gemini-2.0-flash-lite',
    apiModelId: 'gemini-2.0-flash-lite',
    displayName: 'Gemini 2.0 Flash Lite',
    category: 'text',
    thinkingPowerTier: 'low',
    supportsThinking: false,
    thinkingMode: 'none',
    supportsFunctionCalling: true,
    supportsStructuredOutput: false,
    freeTierAvailable: true,
    rateLimitHints: { rpm: 0, tpm: 0, rpd: 0 },
    aliases: ['gemini-2.0-flash-lite-001'],
  },
  'gemini-2.5-flash-lite': {
    id: 'gemini-2.5-flash-lite',
    apiModelId: 'gemini-2.5-flash-lite',
    displayName: 'Gemini 2.5 Flash Lite',
    category: 'text',
    thinkingPowerTier: 'low',
    supportsThinking: true,
    thinkingMode: 'budget',
    supportsFunctionCalling: true,
    supportsStructuredOutput: false,
    freeTierAvailable: true,
    rateLimitHints: { rpm: 10, tpm: 250_000, rpd: 20 },
  },
  'gemini-3.1-flash-lite': {
    id: 'gemini-3.1-flash-lite',
    apiModelId: 'gemini-3.1-flash-lite',
    displayName: 'Gemini 3.1 Flash Lite',
    category: 'text',
    thinkingPowerTier: 'low',
    supportsThinking: true,
    thinkingMode: 'levels',
    supportsFunctionCalling: true,
    supportsStructuredOutput: true,
    freeTierAvailable: true,
    rateLimitHints: { rpm: 15, tpm: 250_000, rpd: 500 },
    aliases: ['gemini-3.1-flash-lite-preview'],
  },
  'gemini-2.0-flash': {
    id: 'gemini-2.0-flash',
    apiModelId: 'gemini-2.0-flash',
    displayName: 'Gemini 2.0 Flash',
    category: 'text',
    thinkingPowerTier: 'medium',
    supportsThinking: false,
    thinkingMode: 'none',
    supportsFunctionCalling: true,
    supportsStructuredOutput: false,
    freeTierAvailable: true,
    rateLimitHints: { rpm: 0, tpm: 0, rpd: 0 },
    aliases: ['gemini-2.0-flash-001'],
  },
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash',
    apiModelId: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    category: 'text',
    thinkingPowerTier: 'medium',
    supportsThinking: true,
    thinkingMode: 'budget',
    supportsFunctionCalling: true,
    supportsStructuredOutput: false,
    freeTierAvailable: true,
    rateLimitHints: { rpm: 5, tpm: 250_000, rpd: 20 },
  },
  'gemini-3-flash': {
    id: 'gemini-3-flash',
    apiModelId: 'gemini-3-flash-preview',
    displayName: 'Gemini 3 Flash',
    category: 'text',
    thinkingPowerTier: 'medium',
    supportsThinking: true,
    thinkingMode: 'levels',
    supportsFunctionCalling: true,
    supportsStructuredOutput: true,
    freeTierAvailable: true,
    rateLimitHints: { rpm: 5, tpm: 250_000, rpd: 20 },
    aliases: ['gemini-3-flash-preview'],
  },
  'gemini-3.5-flash': {
    id: 'gemini-3.5-flash',
    apiModelId: 'gemini-3.5-flash',
    displayName: 'Gemini 3.5 Flash',
    category: 'text',
    thinkingPowerTier: 'medium',
    supportsThinking: true,
    thinkingMode: 'levels',
    supportsFunctionCalling: true,
    supportsStructuredOutput: true,
    freeTierAvailable: true,
    rateLimitHints: { rpm: 5, tpm: 250_000, rpd: 20 },
  },
  'gemini-2.5-pro': {
    id: 'gemini-2.5-pro',
    apiModelId: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    category: 'text',
    thinkingPowerTier: 'high',
    supportsThinking: true,
    thinkingMode: 'budget',
    supportsFunctionCalling: true,
    supportsStructuredOutput: false,
    freeTierAvailable: false,
    rateLimitHints: { rpm: 0, tpm: 0, rpd: 0 },
  },
  'gemini-3.1-pro': {
    id: 'gemini-3.1-pro',
    apiModelId: 'gemini-3.1-pro-preview',
    displayName: 'Gemini 3.1 Pro',
    category: 'text',
    thinkingPowerTier: 'high',
    supportsThinking: true,
    thinkingMode: 'levels',
    supportsFunctionCalling: true,
    supportsStructuredOutput: true,
    freeTierAvailable: false,
    rateLimitHints: { rpm: 0, tpm: 0, rpd: 0 },
    aliases: ['gemini-3.1-pro-preview'],
  },
};

function attachStrengthRanks(
  registry: Record<string, Omit<TextModelInfo, 'strengthRank'>>,
): Record<string, TextModelInfo> {
  const result: Record<string, TextModelInfo> = {};

  for (const [id, model] of Object.entries(registry)) {
    const order = TIER_MODEL_STRENGTH_ORDER[model.thinkingPowerTier];
    const rank = order.indexOf(id);
    result[id] = {
      ...model,
      strengthRank: rank >= 0 ? rank + 1 : undefined,
    };
  }

  return result;
}

/** Official API ids verified via GET /v1beta/models (May 2026). */
export const TEXT_MODEL_REGISTRY: Record<string, TextModelInfo> =
  attachStrengthRanks(BASE_REGISTRY);

const ALIAS_INDEX = buildAliasIndex(TEXT_MODEL_REGISTRY);

function buildAliasIndex(
  registry: Record<string, TextModelInfo>,
): Map<string, TextModelInfo> {
  const index = new Map<string, TextModelInfo>();

  for (const model of Object.values(registry)) {
    index.set(model.id, model);
    index.set(model.apiModelId, model);
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
  tier: ThinkingPowerTier;
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
      tier: info.thinkingPowerTier,
    };
  }

  const thinkingMode = inferThinkingMode(requested);
  const tier = inferThinkingPowerTier(requested);

  return {
    registryKey: requested,
    apiModelId: requested,
    tier,
    info: {
      id: requested,
      apiModelId: requested,
      displayName: requested,
      category: 'text',
      thinkingPowerTier: tier,
      supportsThinking: thinkingMode !== 'none',
      thinkingMode,
      supportsFunctionCalling: inferFunctionCallingSupport(requested),
      supportsStructuredOutput: inferStructuredOutputSupport(requested),
      freeTierAvailable: true,
    },
  };
}

function inferThinkingMode(modelId: string): ThinkingModeKind {
  if (/gemini-2\.0-/.test(modelId)) {
    return 'none';
  }
  if (/gemini-2\.5-/.test(modelId)) {
    return 'budget';
  }
  if (/gemini-3/.test(modelId)) {
    return 'levels';
  }
  return 'none';
}

function inferStructuredOutputSupport(modelId: string): boolean {
  return /gemini-3/.test(modelId);
}

function inferFunctionCallingSupport(_modelId: string): boolean {
  return true;
}

function inferThinkingPowerTier(modelId: string): ThinkingPowerTier {
  if (/pro/i.test(modelId)) {
    return 'high';
  }
  if (/lite/i.test(modelId)) {
    return 'low';
  }
  return 'medium';
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

export function getModelsByTier(
  tier: ThinkingPowerTier,
  options?: GetModelsByTierOptions,
): TextModelInfo[] {
  const priority = TIER_MODEL_STRENGTH_ORDER[tier];
  const byTier = Object.values(TEXT_MODEL_REGISTRY).filter(
    (model) => model.thinkingPowerTier === tier,
  );

  const sorted = byTier.sort(
    (a, b) => priority.indexOf(a.id) - priority.indexOf(b.id),
  );

  return filterModelsByOptions(sorted, options);
}

export function resolveModelForTier(
  tier: ThinkingPowerTier,
  preferFreeTier = true,
): ResolvedTextModel {
  const models = getModelsByTier(tier, { preferFreeTier });

  if (models.length === 0) {
    const allInTier = getModelsByTier(tier, { preferFreeTier: false });
    if (allInTier.length === 0) {
      throw new Error(`No models registered for tier "${tier}".`);
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

export function getDefaultModelId(): string {
  return process.env.GEMINI_DEFAULT_MODEL?.trim() || 'gemini-3.1-flash-lite';
}

export function getDefaultTier(): ThinkingPowerTier {
  const defaultModel = getDefaultModelId();
  const resolved = resolveTextModel(defaultModel);
  return resolved.tier;
}
