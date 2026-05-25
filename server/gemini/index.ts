export {
  callLlm,
  LlmCapabilityError,
  resolveCallModel,
} from './call-llm.js';
export type { InternalCallLlmOptions, InternalCallLlmResult } from './call-llm.js';

export { callLlmAgent, AgentMaxStepsError } from './call-llm-agent.js';

export type {
  CallLlmOptions,
  CallLlmResult,
  LlmFunctionCall,
} from './call-llm.js';

export type { CallLlmAgentOptions, CallLlmAgentResult, AgentStep } from './call-llm-agent.js';

export { generateText, generateTextFromPrompt } from './generate-text.js';

export type { ChatMessage, GenerateTextOptions, GenerateTextResult } from './generate-text.js';

export { getGenAIClient } from './client.js';

export {
  clearExhausted,
  isExhausted,
  markExhausted,
  pingAllModels,
  pingModel,
  resetExhaustionState,
} from './availability.js';

export {
  collectCandidatesForSpeedTier,
  collectModelCandidates,
  getSpeedTierDowngradeChain,
  isSpeedTierDowngraded,
  iterateModelCandidates,
  iterateSpeedTierBatches,
  resolveRequestedSpeedTier,
} from './model-selection.js';

export {
  assertCapability,
  getDefaultModelId,
  getDefaultSpeedTier,
  getModelsBySpeedTier,
  listTextModels,
  resolveModelForSpeedTier,
  resolveTextModel,
  TEXT_MODEL_REGISTRY,
  SPEED_TIER_MODEL_ORDER,
} from './models.js';

export { areSpeedTierBoundsConfigured, SPEED_TIER_BOUNDS_MS } from './speed-tier-bounds.js';
export { buildProbeMatrix, CALIBRATION_PROMPT } from './probe-matrix.js';

export { buildThinkingConfig } from './thinking.js';

export { GeminiQuotaError, formatQuotaError, isQuotaOrRateLimitError } from './rate-limit.js';
