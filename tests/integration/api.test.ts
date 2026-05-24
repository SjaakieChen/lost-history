import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/app.js';
import * as callLlmModule from '../../server/gemini/call-llm.js';
import { GeminiQuotaError } from '../../server/gemini/rate-limit.js';

describe('HTTP API', () => {
  const app = createApp();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/models', () => {
    it('returns models with capability fields and strengthRank', async () => {
      const response = await request(app).get('/api/models').expect(200);

      expect(Array.isArray(response.body.models)).toBe(true);
      expect(response.body.models.length).toBeGreaterThan(0);

      const model = response.body.models.find(
        (entry: { id: string }) => entry.id === 'gemini-3.1-flash-lite',
      );
      expect(model).toMatchObject({
        id: 'gemini-3.1-flash-lite',
        strengthRank: 1,
        supportsFunctionCalling: true,
        supportsStructuredOutput: true,
        thinkingMode: 'levels',
        thinkingPowerTier: 'low',
      });
    });
  });

  describe('POST /api/llm', () => {
    it('returns 200 with callLlm result shape including tier metadata', async () => {
      const spy = vi.spyOn(callLlmModule, 'callLlm').mockResolvedValue({
        text: 'Hello',
        model: 'gemini-3.1-flash-lite',
        thinkingUsed: false,
        thinkingPowerApplied: 'off',
        modelSelectedBy: 'tier',
        thinkingPowerTierRequested: 'low',
        thinkingPowerTierUsed: 'low',
        tierDowngraded: false,
        modelsAttempted: ['gemini-3.1-flash-lite'],
      });

      const response = await request(app)
        .post('/api/llm')
        .send({ prompt: 'Hi', thinkingPowerTier: 'low' })
        .expect(200);

      expect(response.body).toMatchObject({
        text: 'Hello',
        modelSelectedBy: 'tier',
        thinkingPowerTierUsed: 'low',
      });
      expect(spy).toHaveBeenCalledOnce();
    });

    it('returns 400 when input is missing', async () => {
      const spy = vi.spyOn(callLlmModule, 'callLlm');

      const response = await request(app)
        .post('/api/llm')
        .send({ model: 'gemini-2.5-flash-lite' })
        .expect(400);

      expect(response.body.error).toBe('contents, prompt, or messages are required.');
      expect(spy).not.toHaveBeenCalled();
    });

    it('returns 400 with capability details for structuredOutput on 2.0 model', async () => {
      const response = await request(app)
        .post('/api/llm')
        .send({
          prompt: 'Hi',
          model: 'gemini-2.0-flash',
          structuredOutput: { responseSchema: { type: 'object' } },
        })
        .expect(400);

      expect(response.body).toEqual({
        error: 'Model "gemini-2.0-flash" does not support structuredOutput.',
        model: 'gemini-2.0-flash',
        capability: 'structuredOutput',
      });
    });

    it('returns 429 when all models are exhausted', async () => {
      vi.spyOn(callLlmModule, 'callLlm').mockRejectedValue(
        new GeminiQuotaError('All models exhausted', 'gemini-2.5-flash'),
      );

      const response = await request(app)
        .post('/api/llm')
        .send({ prompt: 'Hi', thinkingPowerTier: 'medium' })
        .expect(429);

      expect(response.body.error).toContain('All models exhausted');
      expect(response.body.model).toBe('gemini-2.5-flash');
    });
  });
});
