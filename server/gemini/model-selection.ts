import type { CallLlmOptions, ThinkingPowerTier } from '../../shared/gemini-types.js';
import { isExhausted } from './availability.js';
import {
  getDefaultTier,
  getModelsByTier,
  resolveTextModel,
  type ResolvedTextModel,
} from './models.js';

const TIER_ORDER: ThinkingPowerTier[] = ['high', 'medium', 'low'];

export function getTierDowngradeChain(start: ThinkingPowerTier): ThinkingPowerTier[] {
  const startIndex = TIER_ORDER.indexOf(start);
  if (startIndex === -1) {
    return [start];
  }
  return TIER_ORDER.slice(startIndex);
}

export function resolveRequestedTier(options: CallLlmOptions): ThinkingPowerTier {
  return options.thinkingPowerTier ?? getDefaultTier();
}

function toResolved(model: ResolvedTextModel['info'], tier: ThinkingPowerTier): ResolvedTextModel {
  return {
    registryKey: model.id,
    apiModelId: model.apiModelId,
    info: model,
    tier,
  };
}

export interface ModelCandidateOptions {
  requireFunctionCalling?: boolean;
  requireStructuredOutput?: boolean;
  preferFreeTier?: boolean;
}

export function* iterateModelCandidates(
  options: CallLlmOptions,
  candidateOptions?: ModelCandidateOptions,
): Generator<ResolvedTextModel> {
  if (options.model?.trim()) {
    yield resolveTextModel(options.model.trim());
    return;
  }

  const requestedTier = resolveRequestedTier(options);
  const tierChain = getTierDowngradeChain(requestedTier);

  const filterOptions = {
    preferFreeTier: candidateOptions?.preferFreeTier ?? true,
    requireFunctionCalling: candidateOptions?.requireFunctionCalling,
    requireStructuredOutput: candidateOptions?.requireStructuredOutput,
  };

  for (const tier of tierChain) {
    const models = getModelsByTier(tier, filterOptions);

    for (const model of models) {
      if (isExhausted(model.id)) {
        continue;
      }
      yield toResolved(model, tier);
    }
  }
}

export function collectModelCandidates(
  options: CallLlmOptions,
  candidateOptions?: ModelCandidateOptions,
): ResolvedTextModel[] {
  return [...iterateModelCandidates(options, candidateOptions)];
}

export function isTierDowngraded(
  requested: ThinkingPowerTier,
  used: ThinkingPowerTier,
): boolean {
  const requestedIndex = TIER_ORDER.indexOf(requested);
  const usedIndex = TIER_ORDER.indexOf(used);
  return usedIndex > requestedIndex;
}
