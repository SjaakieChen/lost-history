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
        (entry: { id: string }) => entry.id === 'gemini-3.1-flash-lite-minimal',
      );
      expect(model).toMatchObject({
        id: 'gemini-3.1-flash-lite-minimal',
        strengthRank: expect.any(Number),
        supportsFunctionCalling: true,
        supportsWebSearch: true,
        supportsCodeExecution: false,
        supportsStructuredOutput: true,
        supportsStrictJson: true,
        thinkingMode: 'levels',
        speedTier: 'instant',
        bakedThinkingPower: 'minimal',
      });
    });
  });

  describe('POST /api/llm', () => {
    it('returns 200 with callLlm result shape including speed tier metadata', async () => {
      const spy = vi.spyOn(callLlmModule, 'callLlm').mockResolvedValue({
        text: 'Hello',
        model: 'gemini-3.1-flash-lite',
        registryKey: 'gemini-3.1-flash-lite-minimal',
        thinkingUsed: false,
        thinkingPowerApplied: 'minimal',
        modelSelectedBy: 'tier',
        speedTierRequested: 'instant',
        speedTierUsed: 'instant',
        speedTierDowngraded: false,
        modelsAttempted: ['gemini-3.1-flash-lite-minimal'],
      });

      const response = await request(app)
        .post('/api/llm')
        .send({ prompt: 'Hi', speedTier: 'instant' })
        .expect(200);

      expect(response.body).toMatchObject({
        text: 'Hello',
        modelSelectedBy: 'tier',
        speedTierUsed: 'instant',
      });
      expect(spy).toHaveBeenCalledOnce();
    });

    it('returns 400 when input is missing', async () => {
      const spy = vi.spyOn(callLlmModule, 'callLlm');

      const response = await request(app)
        .post('/api/llm')
        .send({ model: 'gemini-3.5-flash' })
        .expect(400);

      expect(response.body.error).toBe('prompt or messages are required.');
      expect(spy).not.toHaveBeenCalled();
    });

    it('returns 400 with capability details for structuredJson on unsupported model', async () => {
      const response = await request(app)
        .post('/api/llm')
        .send({
          prompt: 'Hi',
          model: 'allam-2-7b-off',
          capabilities: { structuredJson: true },
          structuredOutput: { responseSchema: { type: 'object' } },
        })
        .expect(400);

      expect(response.body).toEqual({
        error: 'Model "allam-2-7b-off" does not support structuredOutput.',
        model: 'allam-2-7b-off',
        capability: 'structuredOutput',
      });
    });

    it('returns 429 when all models are exhausted', async () => {
      vi.spyOn(callLlmModule, 'callLlm').mockRejectedValue(
        new GeminiQuotaError('All models exhausted', 'gemini-3.5-flash-medium'),
      );

      const response = await request(app)
        .post('/api/llm')
        .send({ prompt: 'Hi', speedTier: 'moderate' })
        .expect(429);

      expect(response.body.error).toContain('All models exhausted');
      expect(response.body.model).toBe('gemini-3.5-flash-medium');
    });
  });
});
