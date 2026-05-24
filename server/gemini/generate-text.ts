import type {
  GenerateTextOptions,
  GenerateTextResult,
  ThinkingPower,
} from '../../shared/gemini-types.js';
import { callLlm } from './call-llm.js';
import { getDefaultModelId } from './models.js';

function mapLegacyThinkingPower(options: GenerateTextOptions): ThinkingPower {
  if (options.thinkingPower) {
    return options.thinkingPower;
  }

  if (options.thinkingBudget !== undefined) {
    if (options.thinkingBudget === 0) {
      return 'off';
    }
    if (options.thinkingBudget <= 1024) {
      return 'low';
    }
    if (options.thinkingBudget === -1) {
      return 'medium';
    }
    return 'high';
  }

  if (options.thinking === true || options.includeThoughts === true) {
    return 'medium';
  }

  return 'off';
}

export async function generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
  const result = await callLlm({
    model: options.model?.trim() || getDefaultModelId(),
    thinkingPowerTier: options.thinkingPowerTier,
    thinkingPower: mapLegacyThinkingPower(options),
    prompt: options.prompt,
    messages: options.messages,
    systemInstruction: options.systemInstruction,
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
    includeThoughts: options.includeThoughts,
  });

  return {
    text: result.text,
    thoughts: result.thoughts,
    model: result.model,
    thinkingUsed: result.thinkingUsed,
    usage: result.usage,
  };
}

/** Convenience wrapper for a single prompt string. */
export async function generateTextFromPrompt(
  prompt: string,
  model?: string,
): Promise<string> {
  const result = await generateText({ prompt, model });
  return result.text;
}

export type { ChatMessage, GenerateTextOptions, GenerateTextResult } from '../../shared/gemini-types.js';
