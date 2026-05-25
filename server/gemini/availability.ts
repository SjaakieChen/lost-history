import type { LlmProvider, ModelRateLimitHints } from '../../shared/gemini-types.js';
import { getGroqApiKey } from '../config.js';
import { pingGroqModel } from '../groq/generate.js';
import { getGenAIClient } from './client.js';
import {
  GeminiQuotaError,
  isQuotaOrRateLimitError,
  type BlockedModelInfo,
} from './rate-limit.js';

interface ExhaustionEntry {
  expiresAt: number;
  reason?: string;
}

/** Per-interaction exhaustion cache (callLlm / callLlmAgent / LlmSession). */
export class ExhaustionContext {
  private readonly store = new Map<string, ExhaustionEntry>();

  markExhausted(
    modelId: string,
    hints?: ModelRateLimitHints,
    retryAfterMs?: number,
    source = 'unknown',
    dailyQuotaExhausted = false,
  ): void {
    const ttlMs = computeExhaustionTtlMs(hints, retryAfterMs, dailyQuotaExhausted);
    const expiresAt = Date.now() + ttlMs;
    this.store.set(modelId, { expiresAt, reason: source });
  }

  isExhausted(modelId: string, now = Date.now()): boolean {
    const entry = this.store.get(modelId);
    if (!entry) {
      return false;
    }

    if (entry.expiresAt <= now) {
      this.store.delete(modelId);
      return false;
    }

    return true;
  }

  getExhaustionExpiresAt(modelId: string): number | undefined {
    const entry = this.store.get(modelId);
    if (!entry || entry.expiresAt <= Date.now()) {
      return undefined;
    }
    return entry.expiresAt;
  }

  clearExhausted(modelId: string): void {
    this.store.delete(modelId);
  }

  reset(): void {
    this.store.clear();
  }
}

/** Module default for unit tests that call markExhausted without a scoped context. */
const defaultExhaustionContext = new ExhaustionContext();

export function createExhaustionContext(): ExhaustionContext {
  return new ExhaustionContext();
}

function resolveContext(ctx?: ExhaustionContext): ExhaustionContext {
  return ctx ?? defaultExhaustionContext;
}

const DEFAULT_RPM_COOLDOWN_MS = 60_000;

function msUntilUtcMidnight(from = Date.now()): number {
  const end = new Date(from);
  end.setUTCHours(24, 0, 0, 0);
  return end.getTime() - from;
}

function computeExhaustionTtlMs(
  hints?: ModelRateLimitHints,
  retryAfterMs?: number,
  dailyQuotaExhausted = false,
): number {
  if (dailyQuotaExhausted) {
    return msUntilUtcMidnight();
  }

  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return retryAfterMs + 500;
  }

  if (hints?.rpm !== undefined && hints.rpm > 0) {
    return DEFAULT_RPM_COOLDOWN_MS;
  }

  return DEFAULT_RPM_COOLDOWN_MS;
}

export function markExhausted(
  modelId: string,
  hints?: ModelRateLimitHints,
  retryAfterMs?: number,
  source = 'unknown',
  dailyQuotaExhausted = false,
  ctx?: ExhaustionContext,
): void {
  resolveContext(ctx).markExhausted(
    modelId,
    hints,
    retryAfterMs,
    source,
    dailyQuotaExhausted,
  );
}

export function isExhausted(modelId: string, now = Date.now(), ctx?: ExhaustionContext): boolean {
  return resolveContext(ctx).isExhausted(modelId, now);
}

export function getExhaustionExpiresAt(
  modelId: string,
  ctx?: ExhaustionContext,
): number | undefined {
  return resolveContext(ctx).getExhaustionExpiresAt(modelId);
}

export function clearExhausted(modelId: string, ctx?: ExhaustionContext): void {
  resolveContext(ctx).clearExhausted(modelId);
}

/** Test-only: reset default exhaustion state. */
export function resetExhaustionState(): void {
  defaultExhaustionContext.reset();
}

function isNotFoundError(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  const message = error instanceof Error ? error.message : String(error);
  return status === 404 || /not found/i.test(message);
}

/**
 * Lightweight pre-flight check via models.get (no generation quota).
 * Does not update local generate RPM counters and does not mark models exhausted on 429.
 */
export async function pingModel(
  apiModelId: string,
  registryKey?: string,
  _hints?: ModelRateLimitHints,
  provider: LlmProvider = 'gemini',
  ctx?: ExhaustionContext,
): Promise<boolean> {
  const trackKey = registryKey ?? apiModelId;

  if (isExhausted(trackKey, Date.now(), ctx)) {
    return false;
  }

  if (provider === 'groq') {
    if (!getGroqApiKey()) {
      return false;
    }
    try {
      return await pingGroqModel(apiModelId);
    } catch (error) {
      if (isQuotaOrRateLimitError(error)) {
        return false;
      }
      throw error;
    }
  }

  try {
    const ai = getGenAIClient();
    await ai.models.get({ model: apiModelId });
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }

    if (isQuotaOrRateLimitError(error)) {
      return false;
    }

    throw error;
  }
}

export interface PingTarget {
  apiModelId: string;
  registryKey: string;
  rateLimitHints?: ModelRateLimitHints;
  provider?: LlmProvider;
}

/** Ping all candidate models in parallel; returns registry keys that are reachable. */
export async function pingAllModels(
  targets: PingTarget[],
  ctx?: ExhaustionContext,
): Promise<Set<string>> {
  if (targets.length === 0) {
    return new Set();
  }

  const results = await Promise.all(
    targets.map(async (target) => ({
      registryKey: target.registryKey,
      reachable: await pingModel(
        target.apiModelId,
        target.registryKey,
        target.rateLimitHints,
        target.provider ?? 'gemini',
        ctx,
      ),
    })),
  );

  return new Set(
    results.filter((result) => result.reachable).map((result) => result.registryKey),
  );
}

export function buildNoReachableModelsError(
  options: {
    explicitModel: boolean;
    requestedTier: string;
    allCandidates: Array<{ registryKey: string }>;
    reachableKeys: Set<string>;
  },
  ctx?: ExhaustionContext,
): GeminiQuotaError {
  const now = Date.now();
  const blockedModels: BlockedModelInfo[] = [];

  for (const candidate of options.allCandidates) {
    const expiresAt = getExhaustionExpiresAt(candidate.registryKey, ctx);
    if (expiresAt) {
      blockedModels.push({
        model: candidate.registryKey,
        reason: 'local_cache',
        expiresInMs: expiresAt - now,
      });
      continue;
    }

    if (!options.reachableKeys.has(candidate.registryKey)) {
      blockedModels.push({
        model: candidate.registryKey,
        reason: 'ping_unreachable',
      });
    }
  }

  const onlyLocalCache =
    blockedModels.length > 0 &&
    blockedModels.every((entry) => entry.reason === 'local_cache');

  let message: string;
  if (options.explicitModel && blockedModels.length === 1 && onlyLocalCache) {
    const blocked = blockedModels[0];
    const retrySec = blocked.expiresInMs
      ? Math.ceil(blocked.expiresInMs / 1000)
      : undefined;
    message =
      `Model "${blocked.model}" is temporarily blocked by local quota cache` +
      (retrySec ? ` (retry in ~${retrySec}s)` : '') +
      '. This is not a live API ping failure — a recent generate quota error cached this model. ' +
      'Wait for cache expiry, call resetExhaustionState() in tests, or omit `model` for tier failover.';
  } else if (onlyLocalCache) {
    message =
      `All ${options.requestedTier}-tier candidates are blocked by local quota cache: ` +
      `${blockedModels.map((entry) => entry.model).join(', ')}. ` +
      'Wait for cache expiry or use tier failover after cache clears.';
  } else {
    message =
      `No reachable models for tier "${options.requestedTier}". ` +
      `Candidates: ${options.allCandidates.map((c) => c.registryKey).join(', ') || 'none'}. ` +
      `Blocked: ${blockedModels.map((b) => `${b.model} (${b.reason})`).join(', ') || 'unknown'}.`;
  }

  const retryAfterMs = blockedModels
    .map((b) => b.expiresInMs)
    .filter((ms): ms is number => ms !== undefined)
    .sort((a, b) => a - b)[0];

  return new GeminiQuotaError(message, blockedModels[0]?.model ?? options.requestedTier, {
    failureKind: 'no_reachable_models',
    blockedModels,
    retryAfterMs,
  });
}
