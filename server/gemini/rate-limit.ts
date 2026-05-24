import type { ModelRateLimitHints } from '../../shared/gemini-types.js';
import { markExhausted } from './availability.js';

const lastRequestAt = new Map<string, number>();

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function minIntervalMs(hints?: ModelRateLimitHints): number | undefined {
  const rpm = hints?.rpm;
  if (!rpm || rpm <= 0) {
    return undefined;
  }
  return Math.ceil(60_000 / rpm);
}

async function waitForLocalRateLimit(modelKey: string, hints?: ModelRateLimitHints): Promise<void> {
  const interval = minIntervalMs(hints);
  if (!interval) {
    return;
  }

  const last = lastRequestAt.get(modelKey) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < interval) {
    const waitMs = interval - elapsed;
    // #region agent log
    fetch('http://127.0.0.1:7631/ingest/130840d0-116a-49e4-9207-dfd55fe50a73',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ae9da3'},body:JSON.stringify({sessionId:'ae9da3',hypothesisId:'H5',location:'rate-limit.ts:waitForLocalRateLimit',message:'generate RPM throttle wait',data:{modelKey,waitMs,interval},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    await sleep(waitMs);
  }

  lastRequestAt.set(modelKey, Date.now());
}

export function isQuotaOrRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as { status?: number }).status;

  return (
    status === 429 ||
    /429/.test(message) ||
    /RESOURCE_EXHAUSTED/i.test(message) ||
    /quota/i.test(message) ||
    /rate limit/i.test(message)
  );
}

export type QuotaFailureKind =
  | 'generate_rate_limit'
  | 'generate_daily_quota'
  | 'local_cache_block'
  | 'no_reachable_models';

export interface BlockedModelInfo {
  model: string;
  reason: 'local_cache' | 'ping_unreachable';
  expiresInMs?: number;
}

export interface ParsedQuotaError {
  retryAfterMs?: number;
  dailyQuotaExhausted: boolean;
  quotaMetric?: string;
}

export function parseQuotaErrorDetails(cause: unknown): ParsedQuotaError {
  const message = cause instanceof Error ? cause.message : String(cause);

  let retryAfterMs = (cause as { retryAfterMs?: number }).retryAfterMs;
  if (retryAfterMs === undefined) {
    const retryInMatch = message.match(/retry in (\d+(?:\.\d+)?)s/i);
    if (retryInMatch) {
      retryAfterMs = Math.ceil(parseFloat(retryInMatch[1]) * 1000);
    }
  }

  if (retryAfterMs === undefined) {
    const retryDelayMatch = message.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
    if (retryDelayMatch) {
      retryAfterMs = parseInt(retryDelayMatch[1], 10) * 1000;
    }
  }

  const quotaMetricMatch = message.match(/"quotaMetric"\s*:\s*"([^"]+)"/);
  const quotaMetric = quotaMetricMatch?.[1];

  const dailyQuotaExhausted =
    /PerDay|RequestsPerDay|GenerateRequestsPerDayPerProjectPerModel/i.test(message) ||
    (quotaMetric !== undefined && /PerDay/i.test(quotaMetric));

  return {
    retryAfterMs,
    dailyQuotaExhausted,
    quotaMetric,
  };
}

export class GeminiQuotaError extends Error {
  readonly model: string;
  readonly retryAfterMs?: number;
  readonly failureKind?: QuotaFailureKind;
  readonly blockedModels?: BlockedModelInfo[];

  constructor(
    message: string,
    model: string,
    options?: {
      retryAfterMs?: number;
      failureKind?: QuotaFailureKind;
      blockedModels?: BlockedModelInfo[];
    },
  ) {
    super(message);
    this.name = 'GeminiQuotaError';
    this.model = model;
    this.retryAfterMs = options?.retryAfterMs;
    this.failureKind = options?.failureKind;
    this.blockedModels = options?.blockedModels;
  }
}

function failureKindFromParsed(parsed: ParsedQuotaError): QuotaFailureKind {
  return parsed.dailyQuotaExhausted ? 'generate_daily_quota' : 'generate_rate_limit';
}

export function formatQuotaError(
  model: string,
  cause: unknown,
  hints?: ModelRateLimitHints,
): GeminiQuotaError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const parsed = parseQuotaErrorDetails(cause);
  const failureKind = failureKindFromParsed(parsed);

  markExhausted(
    model,
    hints,
    parsed.retryAfterMs,
    'formatQuotaError',
    parsed.dailyQuotaExhausted,
  );

  const retryHint = parsed.retryAfterMs
    ? ` Retry after ~${Math.ceil(parsed.retryAfterMs / 1000)}s.`
    : '';

  const kindLabel =
    failureKind === 'generate_daily_quota'
      ? 'daily quota exhausted (RPD)'
      : 'rate limit (RPM)';

  return new GeminiQuotaError(
    `Gemini ${kindLabel} for "${model}".${retryHint} Free tier limits are strict — wait and retry, or switch models. Details: ${detail}`,
    model,
    { retryAfterMs: parsed.retryAfterMs, failureKind },
  );
}

export async function withRateLimitAndRetry<T>(
  modelKey: string,
  hints: ModelRateLimitHints | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    await waitForLocalRateLimit(modelKey, hints);

    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isQuotaOrRateLimitError(error)) {
        throw error;
      }

      const parsed = parseQuotaErrorDetails(error);

      if (parsed.dailyQuotaExhausted || attempt === MAX_RETRIES) {
        markExhausted(
          modelKey,
          hints,
          parsed.retryAfterMs,
          'withRateLimitAndRetry:final',
          parsed.dailyQuotaExhausted,
        );
        throw formatQuotaError(modelKey, error, hints);
      }

      markExhausted(
        modelKey,
        hints,
        parsed.retryAfterMs,
        'withRateLimitAndRetry:retry',
        parsed.dailyQuotaExhausted,
      );

      const backoff = Math.max(BASE_BACKOFF_MS * 2 ** attempt, parsed.retryAfterMs ?? 0);
      await sleep(backoff);
    }
  }

  throw formatQuotaError(modelKey, lastError, hints);
}
