import type { ModelRateLimitHints } from '../../shared/gemini-types.js';
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

const exhaustionStore = new Map<string, ExhaustionEntry>();

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
): void {
  const ttlMs = computeExhaustionTtlMs(hints, retryAfterMs, dailyQuotaExhausted);
  const expiresAt = Date.now() + ttlMs;
  exhaustionStore.set(modelId, { expiresAt, reason: source });
  // #region agent log
  fetch('http://127.0.0.1:7631/ingest/130840d0-116a-49e4-9207-dfd55fe50a73',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ae9da3'},body:JSON.stringify({sessionId:'ae9da3',hypothesisId:'H1',location:'availability.ts:markExhausted',message:'markExhausted',data:{modelId,source,ttlMs,ttlMinutes:Math.round(ttlMs/60000),hints,retryAfterMs,dailyQuotaExhausted,expiresAt},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
}

export function isExhausted(modelId: string, now = Date.now()): boolean {
  const entry = exhaustionStore.get(modelId);
  if (!entry) {
    return false;
  }

  if (entry.expiresAt <= now) {
    exhaustionStore.delete(modelId);
    return false;
  }

  return true;
}

export function getExhaustionExpiresAt(modelId: string): number | undefined {
  const entry = exhaustionStore.get(modelId);
  if (!entry || entry.expiresAt <= Date.now()) {
    return undefined;
  }
  return entry.expiresAt;
}

export function clearExhausted(modelId: string): void {
  exhaustionStore.delete(modelId);
}

/** Test-only: reset all exhaustion state. */
export function resetExhaustionState(): void {
  exhaustionStore.clear();
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
): Promise<boolean> {
  const trackKey = registryKey ?? apiModelId;

  if (isExhausted(trackKey)) {
    // #region agent log
    fetch('http://127.0.0.1:7631/ingest/130840d0-116a-49e4-9207-dfd55fe50a73',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ae9da3'},body:JSON.stringify({sessionId:'ae9da3',hypothesisId:'H3',location:'availability.ts:pingModel',message:'ping skipped local exhaustion',data:{trackKey,apiModelId},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return false;
  }

  try {
    const ai = getGenAIClient();
    await ai.models.get({ model: apiModelId });
    // #region agent log
    fetch('http://127.0.0.1:7631/ingest/130840d0-116a-49e4-9207-dfd55fe50a73',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ae9da3'},body:JSON.stringify({sessionId:'ae9da3',hypothesisId:'H2',location:'availability.ts:pingModel',message:'ping succeeded',data:{trackKey,apiModelId},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }

    if (isQuotaOrRateLimitError(error)) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // #region agent log
      fetch('http://127.0.0.1:7631/ingest/130840d0-116a-49e4-9207-dfd55fe50a73',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ae9da3'},body:JSON.stringify({sessionId:'ae9da3',hypothesisId:'H2',location:'availability.ts:pingModel',message:'ping got quota error (not marking exhausted)',data:{trackKey,apiModelId,errorSnippet:errorMessage.slice(0,300)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return false;
    }

    throw error;
  }
}

export interface PingTarget {
  apiModelId: string;
  registryKey: string;
  rateLimitHints?: ModelRateLimitHints;
}

/** Ping all candidate models in parallel; returns registry keys that are reachable. */
export async function pingAllModels(targets: PingTarget[]): Promise<Set<string>> {
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
      ),
    })),
  );

  return new Set(
    results.filter((result) => result.reachable).map((result) => result.registryKey),
  );
}

export function buildNoReachableModelsError(options: {
  explicitModel: boolean;
  requestedTier: string;
  allCandidates: Array<{ registryKey: string }>;
  reachableKeys: Set<string>;
}): GeminiQuotaError {
  const now = Date.now();
  const blockedModels: BlockedModelInfo[] = [];

  for (const candidate of options.allCandidates) {
    const expiresAt = getExhaustionExpiresAt(candidate.registryKey);
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

  return new GeminiQuotaError(message, blockedModels[0]?.model ?? options.requestedTier, {
    failureKind: 'no_reachable_models',
    blockedModels,
  });
}
