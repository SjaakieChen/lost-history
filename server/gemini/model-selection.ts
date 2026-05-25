import type { CallLlmOptions, SpeedTier } from '../../shared/gemini-types.js';
import { type ExhaustionContext, isExhausted } from './availability.js';
import {
  getDefaultSpeedTier,
  getModelsBySpeedTier,
  resolveTextModel,
  type ResolvedTextModel,
} from './models.js';
import {
  getSpeedTierDowngradeChain,
  isSpeedTierDowngraded,
} from './speed-tier-classify.js';

export { getSpeedTierDowngradeChain, isSpeedTierDowngraded };

export function resolveRequestedSpeedTier(options: CallLlmOptions): SpeedTier {
  return options.speedTier ?? getDefaultSpeedTier();
}

function toResolved(model: ResolvedTextModel['info'], tier: SpeedTier): ResolvedTextModel {
  return {
    registryKey: model.id,
    apiModelId: model.apiModelId,
    info: model,
    tier,
  };
}

export interface ModelCandidateOptions {
  requireFunctionCalling?: boolean;
  requireWebSearch?: boolean;
  requireCodeExecution?: boolean;
  requireStructuredOutput?: boolean;
  requireStrictJson?: boolean;
  preferFreeTier?: boolean;
}

export function collectCandidatesForSpeedTier(
  tier: SpeedTier,
  options: CallLlmOptions,
  candidateOptions?: ModelCandidateOptions,
  exhaustionCtx?: ExhaustionContext,
): ResolvedTextModel[] {
  const filterOptions = {
    preferFreeTier: candidateOptions?.preferFreeTier ?? true,
    requireFunctionCalling: candidateOptions?.requireFunctionCalling,
    requireWebSearch: candidateOptions?.requireWebSearch,
    requireCodeExecution: candidateOptions?.requireCodeExecution,
    requireStructuredOutput: candidateOptions?.requireStructuredOutput,
    requireStrictJson: candidateOptions?.requireStrictJson,
  };

  const models = getModelsBySpeedTier(tier, filterOptions);
  const candidates: ResolvedTextModel[] = [];

  for (const model of models) {
    if (isExhausted(model.id, Date.now(), exhaustionCtx)) {
      continue;
    }
    candidates.push(toResolved(model, tier));
  }

  return candidates;
}

export function* iterateSpeedTierBatches(
  options: CallLlmOptions,
  candidateOptions?: ModelCandidateOptions,
): Generator<{ tier: SpeedTier; candidates: ResolvedTextModel[] }> {
  if (options.model?.trim()) {
    return;
  }

  const tierChain = getSpeedTierDowngradeChain(resolveRequestedSpeedTier(options));

  for (const tier of tierChain) {
    const candidates = collectCandidatesForSpeedTier(tier, options, candidateOptions);
    if (candidates.length > 0) {
      yield { tier, candidates };
    }
  }
}

export function* iterateModelCandidates(
  options: CallLlmOptions,
  candidateOptions?: ModelCandidateOptions,
): Generator<ResolvedTextModel> {
  if (options.model?.trim()) {
    yield resolveTextModel(options.model.trim());
    return;
  }

  const requestedTier = resolveRequestedSpeedTier(options);
  const tierChain = getSpeedTierDowngradeChain(requestedTier);

  for (const tier of tierChain) {
    const candidates = collectCandidatesForSpeedTier(tier, options, candidateOptions);
    for (const candidate of candidates) {
      yield candidate;
    }
  }
}

export function collectModelCandidates(
  options: CallLlmOptions,
  candidateOptions?: ModelCandidateOptions,
): ResolvedTextModel[] {
  return [...iterateModelCandidates(options, candidateOptions)];
}

/** Tier batches for failover; optional skip and custom start tier (e.g. preferred model's tier). */
export function* iterateSpeedTierBatchesForFailover(
  options: CallLlmOptions,
  candidateOptions: ModelCandidateOptions | undefined,
  startTier: SpeedTier,
  skipRegistryKey?: string,
  exhaustionCtx?: ExhaustionContext,
): Generator<{ tier: SpeedTier; candidates: ResolvedTextModel[] }> {
  const tierChain = getSpeedTierDowngradeChain(startTier);

  for (const tier of tierChain) {
    const candidates = collectCandidatesForSpeedTier(
      tier,
      options,
      candidateOptions,
      exhaustionCtx,
    ).filter((candidate) => candidate.registryKey !== skipRegistryKey);
    if (candidates.length > 0) {
      yield { tier, candidates };
    }
  }
}
