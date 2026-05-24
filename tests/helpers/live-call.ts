import type {
  CallLlmAgentOptions,
  CallLlmAgentResult,
  CallLlmOptions,
  CallLlmResult,
} from '../../shared/gemini-types.js';
import { callLlmAgent } from '../../server/gemini/call-llm-agent.js';
import { callLlm } from '../../server/gemini/call-llm.js';

function isTransientLiveError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /503|UNAVAILABLE|high demand/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry once on transient Gemini capacity errors during live smoke tests. */
export async function callLlmLive(options: CallLlmOptions): Promise<CallLlmResult> {
  try {
    return await callLlm(options);
  } catch (error) {
    if (!isTransientLiveError(error)) {
      throw error;
    }

    await sleep(3_000);
    return callLlm(options);
  }
}

/** Retry once on transient Gemini capacity errors during live agent smoke tests. */
export async function callLlmAgentLive(
  options: CallLlmAgentOptions,
): Promise<CallLlmAgentResult> {
  try {
    return await callLlmAgent(options);
  } catch (error) {
    if (!isTransientLiveError(error)) {
      throw error;
    }

    await sleep(3_000);
    return callLlmAgent(options);
  }
}
