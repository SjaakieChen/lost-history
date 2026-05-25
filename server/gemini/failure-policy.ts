import { LlmCapabilityError } from './models.js';
import { GeminiQuotaError, isQuotaOrRateLimitError } from './rate-limit.js';

/** Policy / safety blocks — failover to another model but log (do not silently ignore). */
export function isPolicyBlockedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as { status?: number }).status;
  if (status === 400 && /policy|safety|blocked|harm|RECITATION|SAFETY/i.test(message)) {
    return true;
  }
  return /policy|safety|blocked|harm|RECITATION|SAFETY|content.?filter/i.test(message);
}

export function logPolicyBlocked(registryKey: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(
    `[llm] Policy/safety block on "${registryKey}" — failing over to another model. ${detail}`,
  );
}

/**
 * Failures where another model in the tier chain may succeed.
 * Capability mismatches are not recoverable (caller must change options).
 */
export function isRecoverableLlmFailure(error: unknown): boolean {
  if (error instanceof LlmCapabilityError) {
    return false;
  }
  if (error instanceof GeminiQuotaError) {
    return true;
  }
  if (isQuotaOrRateLimitError(error)) {
    return true;
  }
  if (isPolicyBlockedError(error)) {
    return true;
  }

  const status = (error as { status?: number }).status;
  if (status === 401 || status === 403) {
    return true;
  }
  if (status !== undefined && status >= 500) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/unavailable|overloaded|internal error|temporarily/i.test(message)) {
    return true;
  }

  return false;
}

export function isInvalidModelOutput(result: {
  text?: string;
  functionCalls?: unknown[];
  thoughts?: string;
}): boolean {
  const hasCalls = Boolean(result.functionCalls?.length);
  const hasText = Boolean(result.text?.trim() && result.text !== 'No response text received.');
  const hasThoughtsOnly = Boolean(result.thoughts?.trim() && !hasCalls && !hasText);
  if (hasThoughtsOnly) {
    return false;
  }
  return !hasCalls && !hasText;
}
