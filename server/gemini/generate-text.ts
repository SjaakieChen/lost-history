import type { CallLlmOptions, GenerateTextResult } from '../../shared/gemini-types.js';
import { callLlm } from './call-llm.js';
import { getDefaultModelId } from './models.js';

/** Text-only chat options (subset of CallLlmOptions). */
export type GenerateTextOptions = Pick<
  CallLlmOptions,
  'model' | 'prompt' | 'messages' | 'systemInstruction' | 'maxOutputTokens' | 'includeThoughts' | 'speedTier'
>;

export async function generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
  const result = await callLlm({
    model: options.model?.trim() || getDefaultModelId(),
    speedTier: options.speedTier,
    prompt: options.prompt,
    messages: options.messages,
    systemInstruction: options.systemInstruction,
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

export type { ChatMessage, GenerateTextResult } from '../../shared/gemini-types.js';
