/** Shared Gemini types safe for frontend and server. */

export type ModelCategory = 'text' | 'embedding' | 'image' | 'tts' | 'other';

/** LLM API backend for a registry entry. */
export type LlmProvider = 'gemini' | 'groq';

/** Response-speed bucket for model routing (fastest → slowest). */
export type SpeedTier = 'instant' | 'fast' | 'moderate' | 'slow';

/**
 * How a model exposes thinking controls.
 * - none: no internal reasoning (e.g. Gemini 2.0 Flash)
 * - budget: token budget only (Gemini 2.5 series)
 * - levels: discrete levels incl. minimal/low/medium/high (Gemini 3+)
 */
export type ThinkingModeKind = 'none' | 'budget' | 'levels';

export interface ModelRateLimitHints {
  rpm?: number;
  tpm?: number;
  rpd?: number;
}

/**
 * Specialist routing labels (beyond speed tiers) that must be set explicitly for every catalog model.
 * Used by tier failover (`requireFunctionCalling`, `requireStructuredOutput`, etc.).
 *
 * - `supportsFunctionCalling` — local/OpenAPI tools (`tools` on the request).
 * - `supportsWebSearch` — provider built-in web search (e.g. Groq Compound).
 * - `supportsCodeExecution` — provider built-in code execution (e.g. Groq Compound + E2B).
 * - `supportsStructuredOutput` — best-effort JSON schema / JSON object mode.
 * - `supportsStrictJson` — guaranteed schema adherence: Gemini `responseSchema` / JSON Schema;
 *   Groq `response_format: { type: 'json_schema', json_schema: { strict: true, ... } }`.
 */
export interface ModelCapabilityLabels {
  supportsThinking: boolean;
  thinkingMode: ThinkingModeKind;
  supportsFunctionCalling: boolean;
  supportsWebSearch: boolean;
  supportsCodeExecution: boolean;
  supportsStructuredOutput: boolean;
  supportsStrictJson: boolean;
  freeTierAvailable: boolean;
}

/** One API model row before speed-tier assignment and thinking-variant probes. */
export interface CatalogModelDefinition extends ModelCapabilityLabels {
  id: string;
  apiModelId: string;
  displayName: string;
  category: ModelCategory;
  provider: LlmProvider;
  rateLimitHints?: ModelRateLimitHints;
  aliases?: string[];
}

export interface TextModelInfo {
  id: string;
  apiModelId: string;
  displayName: string;
  category: ModelCategory;
  /** API backend (default gemini). */
  provider?: LlmProvider;
  /** Speed bucket assigned from calibration (or heuristic until bounds are configured). */
  speedTier: SpeedTier;
  /** Fixed reasoning depth for this registry entry; not overridable by callers. */
  bakedThinkingPower: ThinkingPower;
  supportsThinking: boolean;
  thinkingMode: ThinkingModeKind;
  supportsFunctionCalling: boolean;
  supportsWebSearch: boolean;
  supportsCodeExecution: boolean;
  /** Best-effort structured JSON (Gemini 3+ schema; Groq `json_schema` with `strict: false` or JSON object mode). */
  supportsStructuredOutput: boolean;
  /** Guaranteed schema match (Gemini 3+; Groq `json_schema.strict: true` on supported models). */
  supportsStrictJson: boolean;
  freeTierAvailable: boolean;
  /** 1 = strongest within its speedTier. */
  strengthRank?: number;
  rateLimitHints?: ModelRateLimitHints;
  aliases?: string[];
}

export interface GetModelsByTierOptions {
  preferFreeTier?: boolean;
  requireFunctionCalling?: boolean;
  requireWebSearch?: boolean;
  requireCodeExecution?: boolean;
  requireStructuredOutput?: boolean;
  requireStrictJson?: boolean;
}

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Set when `role === 'tool'`. */
  toolName?: string;
  /** Optional correlation id for exported tool rounds. */
  toolCallId?: string;
  /** Registry id of the model that produced this turn (assistant / tool). */
  model?: string;
}

/** OpenAPI-style function declaration passed to the model. */
export interface LlmFunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export type FunctionCallingMode = 'AUTO' | 'ANY' | 'NONE' | 'VALIDATED';

/** Internal reasoning depth baked per registry entry; mapped per model family in the server. */
export type ThinkingPower = 'off' | 'minimal' | 'low' | 'medium' | 'high';

export interface LlmStructuredOutput {
  /** JSON Schema (preferred for Gemini 3). */
  responseJsonSchema?: unknown;
  /** OpenAPI subset schema. */
  responseSchema?: Record<string, unknown>;
}

/** Unified LLM call surface. */
export interface CallLlmOptions {
  /** Explicit registry id or API model id. */
  model?: string;
  /**
   * When `model` is omitted, pick the strongest available model for this speed tier.
   * Ignored if `model` is set.
   */
  speedTier?: SpeedTier;
  systemInstruction?: string;
  prompt?: string;
  messages?: ChatMessage[];
  tools?: LlmFunctionDeclaration[];
  functionCallingMode?: FunctionCallingMode;
  structuredOutput?: LlmStructuredOutput;
  maxOutputTokens?: number;
  includeThoughts?: boolean;
}

export interface GenerateTextUsage {
  promptTokens?: number;
  candidatesTokens?: number;
  totalTokens?: number;
  thoughtsTokens?: number;
}

export interface LlmFunctionCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

export interface CallLlmResult {
  text: string;
  thoughts?: string;
  functionCalls?: LlmFunctionCall[];
  /** Portable transcript for cross-model chaining (agent runs). */
  messages?: ChatMessage[];
  model: string;
  /** Stable registry id for locking / failover (prefer over `model` API id). */
  registryKey: string;
  thinkingUsed: boolean;
  thinkingPowerApplied: ThinkingPower;
  finishReason?: string;
  usage?: GenerateTextUsage;
  speedTierRequested?: SpeedTier;
  speedTierUsed?: SpeedTier;
  speedTierDowngraded?: boolean;
  modelsAttempted?: string[];
  modelSelectedBy?: 'explicit' | 'tier' | 'preferred_failover';
}

/** Server-side tool handler for agent loops. */
export type LlmToolHandler = (
  args: Record<string, unknown>,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

export type AgentTerminationMode = 'both' | 'natural_only' | 'final_tool_only';

export interface FinalAnswerToolConfig {
  name?: string;
  description?: string;
}

/** Options for multi-turn agent loop with automatic tool execution. */
export interface CallLlmAgentOptions extends CallLlmOptions {
  toolHandlers: Record<string, LlmToolHandler>;
  /** Maximum generate turns before AgentMaxStepsError. Default: 10. */
  maxSteps?: number;
  /** Default: both — prefer submit_final_answer, allow plain-text fallback. */
  termination?: AgentTerminationMode;
  finalAnswerTool?: FinalAnswerToolConfig;
  /**
   * When set, the agent executes tools in this order (one primary tool per step).
   * Premature submit_final_answer calls receive a rejection and the loop continues.
   */
  toolSequence?: string[];
}

export type AgentTerminationReason = 'final_tool' | 'natural' | 'max_steps';

export interface AgentToolResult {
  name: string;
  response: Record<string, unknown>;
}

export interface AgentStep {
  step: number;
  model: string;
  text?: string;
  thoughts?: string;
  functionCalls?: LlmFunctionCall[];
  toolResults?: AgentToolResult[];
  finishReason?: string;
  /** Wall-clock ms for this agent step's LLM call. */
  durationMs?: number;
}

export interface ExportMessagesOptions {
  /** Default true — include `<tool_call>` blocks and `tool` role messages. */
  includeToolSummary?: boolean;
}

/** Options for `LlmSession`. */
export type LlmSessionOptions = CallLlmOptions;

export interface CallLlmAgentResult extends CallLlmResult {
  terminationReason: AgentTerminationReason;
  steps: AgentStep[];
  stepCount: number;
}

/** Text-only chat helper result (no tools / structured output). */
export interface GenerateTextResult {
  text: string;
  thoughts?: string;
  model: string;
  thinkingUsed: boolean;
  usage?: GenerateTextUsage;
}

export interface LlmCapabilityErrorDetails {
  model: string;
  capability:
    | 'functionCalling'
    | 'webSearch'
    | 'codeExecution'
    | 'structuredOutput'
    | 'strictJson'
    | 'thinking';
  message: string;
}
