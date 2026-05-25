import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearExhausted,
  isExhausted,
  markExhausted,
  pingAllModels,
  pingModel,
  resetExhaustionState,
} from '../../server/gemini/availability.js';
import { resetExhaustionState as resetFromHelper } from '../helpers/availability.js';

vi.mock('../../server/gemini/client.js', () => ({
  getGenAIClient: vi.fn(),
}));

import { getGenAIClient } from '../../server/gemini/client.js';

describe('exhaustion tracker', () => {
  beforeEach(() => {
    resetExhaustionState();
    vi.useRealTimers();
  });

  afterEach(() => {
    resetExhaustionState();
    vi.useRealTimers();
  });

  it('is not exhausted before mark', () => {
    expect(isExhausted('gemini-2.5-flash-lite')).toBe(false);
  });

  it('is exhausted immediately after mark', () => {
    markExhausted('gemini-2.5-flash-lite');
    expect(isExhausted('gemini-2.5-flash-lite')).toBe(true);
  });

  it('expires RPM cooldown after ~60s with fake timers', () => {
    vi.useFakeTimers();
    markExhausted('gemini-2.5-flash-lite', { rpm: 5 });
    expect(isExhausted('gemini-2.5-flash-lite')).toBe(true);

    vi.advanceTimersByTime(61_000);
    expect(isExhausted('gemini-2.5-flash-lite')).toBe(false);
  });

  it('uses retryAfterMs TTL when provided', () => {
    vi.useFakeTimers();
    markExhausted('gemini-2.5-flash-lite', { rpd: 20, rpm: 10 }, 40_000);
    expect(isExhausted('gemini-2.5-flash-lite')).toBe(true);

    vi.advanceTimersByTime(40_500);
    expect(isExhausted('gemini-2.5-flash-lite')).toBe(false);
  });

  it('persists RPD exhaustion until UTC midnight when dailyQuotaExhausted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T12:00:00Z'));
    markExhausted('gemini-2.5-flash', { rpd: 20, rpm: 5 }, undefined, 'test', true);

    vi.advanceTimersByTime(30 * 60_000);
    expect(isExhausted('gemini-2.5-flash')).toBe(true);

    vi.advanceTimersByTime(12 * 60 * 60_000);
    expect(isExhausted('gemini-2.5-flash')).toBe(false);
  });

  it('clearExhausted removes entry immediately', () => {
    markExhausted('gemini-2.5-flash-lite');
    clearExhausted('gemini-2.5-flash-lite');
    expect(isExhausted('gemini-2.5-flash-lite')).toBe(false);
  });

  it('resetExhaustionState clears all entries', () => {
    markExhausted('a');
    markExhausted('b');
    resetFromHelper();
    expect(isExhausted('a')).toBe(false);
    expect(isExhausted('b')).toBe(false);
  });
});

describe('pingModel', () => {
  const mockedGetGenAIClient = vi.mocked(getGenAIClient);

  beforeEach(() => {
    resetExhaustionState();
    vi.clearAllMocks();
  });

  it('returns true when models.get succeeds', async () => {
    mockedGetGenAIClient.mockReturnValue({
      models: { get: vi.fn().mockResolvedValue({ name: 'gemini-2.5-flash-lite' }) },
    } as never);

    const result = await pingModel('gemini-2.5-flash-lite', 'gemini-2.5-flash-lite');
    expect(result).toBe(true);
  });

  it('returns false on 404 without marking exhausted', async () => {
    mockedGetGenAIClient.mockReturnValue({
      models: {
        get: vi.fn().mockRejectedValue({ status: 404, message: 'not found' }),
      },
    } as never);

    const result = await pingModel('missing-model', 'missing-model');
    expect(result).toBe(false);
    expect(isExhausted('missing-model')).toBe(false);
  });

  it('returns false on 429 without marking exhausted', async () => {
    mockedGetGenAIClient.mockReturnValue({
      models: {
        get: vi.fn().mockRejectedValue({ status: 429, message: 'rate limit' }),
      },
    } as never);

    const result = await pingModel('gemini-2.5-flash', 'gemini-2.5-flash', { rpm: 5 });
    expect(result).toBe(false);
    expect(isExhausted('gemini-2.5-flash')).toBe(false);
  });

  it('returns false when model is locally exhausted without calling API', async () => {
    markExhausted('gemini-2.5-flash-lite');
    const get = vi.fn();
    mockedGetGenAIClient.mockReturnValue({ models: { get } } as never);

    const result = await pingModel('gemini-2.5-flash-lite', 'gemini-2.5-flash-lite');
    expect(result).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('pingAllModels', () => {
  const mockedGetGenAIClient = vi.mocked(getGenAIClient);

  beforeEach(() => {
    resetExhaustionState();
    vi.clearAllMocks();
  });

  it('pings all targets in parallel and returns reachable registry keys', async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce({ status: 429, message: 'rate limit' })
      .mockResolvedValueOnce({ name: 'gemini-2.5-flash-lite' })
      .mockResolvedValueOnce({ name: 'gemini-3.5-flash' });
    mockedGetGenAIClient.mockReturnValue({ models: { get } } as never);

    const reachable = await pingAllModels([
      { apiModelId: 'gemini-3.1-flash-lite', registryKey: 'gemini-3.1-flash-lite' },
      { apiModelId: 'gemini-2.5-flash-lite', registryKey: 'gemini-2.5-flash-lite' },
      { apiModelId: 'gemini-3.5-flash', registryKey: 'gemini-3.5-flash' },
    ]);

    expect(get).toHaveBeenCalledTimes(3);
    expect(reachable.has('gemini-3.1-flash-lite')).toBe(false);
    expect(reachable.has('gemini-2.5-flash-lite')).toBe(true);
    expect(reachable.has('gemini-3.5-flash')).toBe(true);
  });
});
