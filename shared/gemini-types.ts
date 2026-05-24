/** Shared Gemini types safe for frontend and server. */



export type ModelCategory = 'text' | 'embedding' | 'image' | 'tts' | 'other';



/** Model capability tier for routing by reasoning depth. */

export type ThinkingPowerTier = 'low' | 'medium' | 'high';



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



export interface TextModelInfo {

  id: string;

  apiModelId: string;

  displayName: string;

  category: ModelCategory;

  /** Assigned low / medium / high tier for model selection. */

  thinkingPowerTier: ThinkingPowerTier;

  supportsThinking: boolean;

  thinkingMode: ThinkingModeKind;

  supportsFunctionCalling: boolean;

  /** Gemini 3+ structured JSON output via responseSchema. */

  supportsStructuredOutput: boolean;

  freeTierAvailable: boolean;

  /** 1 = strongest within its thinkingPowerTier. */
  strengthRank?: number;

  rateLimitHints?: ModelRateLimitHints;

  aliases?: string[];

}

export interface GetModelsByTierOptions {
  preferFreeTier?: boolean;
  requireFunctionCalling?: boolean;
  requireStructuredOutput?: boolean;
}



export type ChatRole = 'user' | 'assistant' | 'system';



export interface ChatMessage {

  role: ChatRole;

  content: string;

}



/**

 * Serializable Gemini Content block for multi-turn history.

 * Prefer appending `modelContent` from CallLlmResult verbatim for function calling.

 */

export interface LlmContentBlock {

  role?: 'user' | 'model';

  parts?: Array<Record<string, unknown>>;

}



/** OpenAPI-style function declaration passed to the model. */

export interface LlmFunctionDeclaration {

  name: string;

  description: string;

  parameters?: Record<string, unknown>;

}



export type FunctionCallingMode = 'AUTO' | 'ANY' | 'NONE' | 'VALIDATED';



/** Requested reasoning depth; mapped per model family in the server. */

export type ThinkingPower = 'off' | 'low' | 'medium' | 'high';



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

   * When `model` is omitted, pick the default free-tier model for this tier.

   * Ignored if `model` is set.

   */

  thinkingPowerTier?: ThinkingPowerTier;

  /** How much internal reasoning to use (mapped per model). Default: off. */

  thinkingPower?: ThinkingPower;

  systemInstruction?: string;

  prompt?: string;

  messages?: ChatMessage[];

  /** Full Gemini contents for multi-turn / function calling (preserves thought signatures). */

  contents?: LlmContentBlock[];

  tools?: LlmFunctionDeclaration[];

  functionCallingMode?: FunctionCallingMode;

  structuredOutput?: LlmStructuredOutput;

  temperature?: number;

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

  /** Append to contents on the next turn (includes thought signatures). */

  modelContent?: LlmContentBlock;

  model: string;

  thinkingUsed: boolean;

  thinkingPowerApplied: ThinkingPower;

  finishReason?: string;

  usage?: GenerateTextUsage;

  thinkingPowerTierRequested?: ThinkingPowerTier;

  thinkingPowerTierUsed?: ThinkingPowerTier;

  tierDowngraded?: boolean;

  modelsAttempted?: string[];

  modelSelectedBy?: 'explicit' | 'tier';

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

}



export interface CallLlmAgentResult extends CallLlmResult {

  terminationReason: AgentTerminationReason;

  steps: AgentStep[];

  stepCount: number;

}



/** @deprecated Use CallLlmOptions — kept for /api/chat compatibility. */

export interface GenerateTextOptions {

  model?: string;

  prompt?: string;

  messages?: ChatMessage[];

  systemInstruction?: string;

  temperature?: number;

  maxOutputTokens?: number;

  thinking?: boolean;

  thinkingBudget?: number;

  includeThoughts?: boolean;

  thinkingPower?: ThinkingPower;

  thinkingPowerTier?: ThinkingPowerTier;

}



export interface GenerateTextResult {

  text: string;

  thoughts?: string;

  model: string;

  thinkingUsed: boolean;

  usage?: GenerateTextUsage;

}



export interface LlmCapabilityErrorDetails {

  model: string;

  capability: 'functionCalling' | 'structuredOutput' | 'thinking';

  message: string;

}


