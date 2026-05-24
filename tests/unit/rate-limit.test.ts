import { afterEach, describe, expect, it, vi } from 'vitest';
import { isExhausted, resetExhaustionState } from '../../server/gemini/availability.js';
import {
  formatQuotaError,
  GeminiQuotaError,
  isQuotaOrRateLimitError,
  parseQuotaErrorDetails,
  withRateLimitAndRetry,
} from '../../server/gemini/rate-limit.js';

describe('isQuotaOrRateLimitError', () => {
  it('detects 429 status', () => {
    expect(isQuotaOrRateLimitError({ status: 429, message: 'Too many requests' })).toBe(true);
  });

  it('detects quota and rate limit messages', () => {
    expect(isQuotaOrRateLimitError(new Error('RESOURCE_EXHAUSTED'))).toBe(true);
    expect(isQuotaOrRateLimitError(new Error('Quota exceeded'))).toBe(true);
    expect(isQuotaOrRateLimitError(new Error('Rate limit hit'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isQuotaOrRateLimitError(new Error('Invalid API key'))).toBe(false);
  });
});

describe('withRateLimitAndRetry', () => {
  it('retries on rate limit errors and succeeds', async () => {
    vi.useFakeTimers();

    const operation = vi
      .fn()
      .mockRejectedValueOnce({ status: 429, message: 'rate limit' })
      .mockResolvedValueOnce('ok');

    const promise = withRateLimitAndRetry('gemini-2.5-flash', { rpm: 0 }, operation);

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('throws GeminiQuotaError after max retries', async () => {
    vi.useFakeTimers();

    const operation = vi.fn().mockRejectedValue({ status: 429, message: 'rate limit' });
    const promise = withRateLimitAndRetry('gemini-2.5-flash', undefined, operation);
    const expectation = expect(promise).rejects.toBeInstanceOf(GeminiQuotaError);

    await vi.runAllTimersAsync();
    await expectation;
    expect(operation).toHaveBeenCalledTimes(4);

    vi.useRealTimers();
  });

  it('rethrows non-rate-limit errors immediately', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('bad request'));

    await expect(withRateLimitAndRetry('model', undefined, operation)).rejects.toThrow(
      'bad request',
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe('parseQuotaErrorDetails', () => {
  it('parses retry in seconds from message', () => {
    const parsed = parseQuotaErrorDetails(
      new Error('Please retry in 38.569663583s'),
    );
    expect(parsed.retryAfterMs).toBe(38_570);
    expect(parsed.dailyQuotaExhausted).toBe(false);
  });

  it('detects daily quota from quotaMetric', () => {
    const parsed = parseQuotaErrorDetails(
      new Error(
        '{"quotaMetric":"generativelanguage.googleapis.com/generate_content_free_tier_requests","quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}',
      ),
    );
    expect(parsed.dailyQuotaExhausted).toBe(true);
  });
});

describe('formatQuotaError', () => {
  afterEach(() => {
    resetExhaustionState();
  });

  it('wraps cause in GeminiQuotaError with model id', () => {
    const error = formatQuotaError('gemini-2.5-flash-lite', new Error('429 quota'));
    expect(error).toBeInstanceOf(GeminiQuotaError);
    expect(error.model).toBe('gemini-2.5-flash-lite');
    expect(error.message).toContain('Gemini rate limit (RPM)');
  });

  it('marks model exhausted when formatting quota error', () => {
    formatQuotaError('gemini-2.5-flash-lite', new Error('429 quota'));
    expect(isExhausted('gemini-2.5-flash-lite')).toBe(true);
  });
});

describe('withRateLimitAndRetry exhaustion hook', () => {
  afterEach(() => {
    resetExhaustionState();
    vi.useRealTimers();
  });

  it('marks model exhausted after max retries on quota errors', async () => {
    vi.useFakeTimers();

    const operation = vi.fn().mockRejectedValue({ status: 429, message: 'rate limit' });
    const promise = withRateLimitAndRetry('gemini-2.5-flash', undefined, operation);
    const expectation = expect(promise).rejects.toBeInstanceOf(GeminiQuotaError);

    await vi.runAllTimersAsync();
    await expectation;
    expect(isExhausted('gemini-2.5-flash')).toBe(true);
  });
});
