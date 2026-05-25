export {
  callLlm,
  generateText,
  generateTextFromPrompt,
  getDefaultModelId,
  listTextModels,
  getModelsBySpeedTier,
  resolveModelForSpeedTier,
  GeminiQuotaError,
  LlmCapabilityError,
  AgentMaxStepsError,
} from './gemini/index.js';

export { LlmSession } from './llm/session.js';

export type {
  CallLlmOptions,
  CallLlmResult,
  GenerateTextOptions,
  GenerateTextResult,
  LlmFunctionCall,
} from './gemini/index.js';
export type { ExportMessagesOptions, LlmSessionOptions } from '../shared/gemini-types.js';
