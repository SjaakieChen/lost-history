import type { CallLlmAgentResult, CallLlmResult } from '../../shared/gemini-types.js';
import { GeminiQuotaError } from '../../server/gemini/rate-limit.js';

const TEXT_PREVIEW_CHARS = 500;
const THOUGHTS_PREVIEW_CHARS = 300;

function preview(text: string | undefined, maxChars: number): string {
  if (!text?.trim()) {
    return '(empty)';
  }
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars)}…`;
}

function modelsThatDidNotSucceed(result: CallLlmResult): string[] {
  const attempted = result.modelsAttempted ?? [];
  const winner = result.registryKey;
  return attempted.filter((key) => key !== winner);
}

function logRoutingSummary(result: CallLlmResult): void {
  console.log(`  Winner (registry): ${result.registryKey}`);
  console.log(`  API model:         ${result.model}`);
  console.log(`  Selected by:       ${result.modelSelectedBy ?? '(unknown)'}`);
  console.log(
    `  Speed tier:        ${result.speedTierRequested ?? '?'} → ${result.speedTierUsed ?? '?'}${result.speedTierDowngraded ? ' (downgraded)' : ''}`,
  );
  console.log(`  Models attempted:  ${(result.modelsAttempted ?? []).join(', ') || '(none)'}`);
  const failed = modelsThatDidNotSucceed(result);
  console.log(
    `  Did not succeed:   ${failed.length > 0 ? failed.join(', ') : '(none — first pick won)'}`,
  );
  if (result.usage) {
    console.log(`  Usage:             ${JSON.stringify(result.usage)}`);
  }
}

/** Structured console output for a single-turn live call. */
export function logLiveCallResult(label: string, result: CallLlmResult): void {
  console.log(`\n--- Live: ${label} ---`);
  logRoutingSummary(result);
  console.log(`  Thinking:          ${result.thinkingUsed ? result.thinkingPowerApplied : 'off'}`);
  console.log(`  Text preview:\n${preview(result.text, TEXT_PREVIEW_CHARS)}`);
  if (result.thoughts?.trim()) {
    console.log(`  Thoughts preview:\n${preview(result.thoughts, THOUGHTS_PREVIEW_CHARS)}`);
  }
  console.log('--- end ---\n');
}

/** Structured console output for an agent live run. */
export function logLiveAgentResult(label: string, result: CallLlmAgentResult): void {
  console.log(`\n--- Live: ${label} ---`);
  logRoutingSummary(result);
  console.log(`  Termination:       ${result.terminationReason}`);
  console.log(`  Steps:             ${result.stepCount}`);

  for (const step of result.steps) {
    console.log(`\n  [Step ${step.step}] model=${step.model} durationMs=${step.durationMs ?? '?'}`);
    if (step.functionCalls?.length) {
      for (const call of step.functionCalls) {
        console.log(`    functionCall: ${call.name}(${JSON.stringify(call.args ?? {})})`);
      }
    }
    if (step.toolResults?.length) {
      for (const tr of step.toolResults) {
        console.log(`    toolResult: ${tr.name} → ${JSON.stringify(tr.response)}`);
      }
    }
    if (step.text?.trim()) {
      console.log(`    text: ${preview(step.text, 200)}`);
    }
    if (step.thoughts?.trim()) {
      console.log(`    thoughts: ${preview(step.thoughts, 150)}`);
    }
  }

  console.log(`\n  Final answer preview:\n${preview(result.text, TEXT_PREVIEW_CHARS)}`);
  console.log('--- end ---\n');
}

/** Log quota / exhaustion details when a live call throws. */
export function logLiveCallError(label: string, error: unknown): void {
  console.log(`\n--- Live FAILED: ${label} ---`);
  if (error instanceof GeminiQuotaError) {
    console.log(`  Error:          ${error.message}`);
    console.log(`  Model:          ${error.model}`);
    console.log(`  Failure kind:   ${error.failureKind ?? '(unknown)'}`);
    if (error.retryAfterMs !== undefined) {
      console.log(`  Retry after:    ${error.retryAfterMs}ms`);
    }
    if (error.blockedModels?.length) {
      console.log('  Blocked models:');
      for (const blocked of error.blockedModels) {
        console.log(`    - ${blocked.model} (${blocked.reason})`);
      }
    }
  } else if (error instanceof Error) {
    console.log(`  ${error.name}: ${error.message}`);
  } else {
    console.log(`  ${String(error)}`);
  }
  console.log('--- end ---\n');
}
