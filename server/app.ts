import cors from 'cors';
import express from 'express';
import {
  callLlm,
  generateText,
  listTextModels,
  GeminiQuotaError,
  LlmCapabilityError,
} from './gemini.js';
import type { CallLlmOptions } from '../shared/gemini-types.js';
import type { GenerateTextOptions } from './gemini/generate-text.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/models', (_req, res) => {
    res.json({ models: listTextModels() });
  });

  app.post('/api/llm', async (req, res) => {
    try {
      const body = req.body as CallLlmOptions;

      if (!body.prompt?.trim() && !body.messages?.length) {
        res.status(400).json({ error: 'prompt or messages are required.' });
        return;
      }

      const result = await callLlm(body);
      const { threadState: _threadState, ...publicResult } =
        result as typeof result & { threadState?: unknown };
      res.json(publicResult);
    } catch (error) {
      if (error instanceof LlmCapabilityError) {
        res.status(400).json({
          error: error.message,
          model: error.model,
          capability: error.capability,
        });
        return;
      }

      if (error instanceof GeminiQuotaError) {
        const retryAfterSec = error.retryAfterMs
          ? Math.ceil(error.retryAfterMs / 1000)
          : undefined;
        res.status(429).json({
          error: error.message,
          model: error.model,
          registryKey: error.model,
          failureKind: error.failureKind,
          blockedModels: error.blockedModels,
          ...(retryAfterSec !== undefined
            ? { retryAfterSec, retryAfterMs: error.retryAfterMs }
            : {}),
        });
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const body = req.body as GenerateTextOptions & { prompt?: string };

      if (!body.prompt?.trim() && !body.messages?.length) {
        res.status(400).json({ error: 'Prompt or messages are required.' });
        return;
      }

      const result = await generateText({
        model: body.model,
        prompt: body.prompt?.trim(),
        messages: body.messages,
        systemInstruction: body.systemInstruction,
        maxOutputTokens: body.maxOutputTokens,
        includeThoughts: body.includeThoughts,
        speedTier: body.speedTier,
      });

      res.json(result);
    } catch (error) {
      if (error instanceof GeminiQuotaError) {
        const retryAfterSec = error.retryAfterMs
          ? Math.ceil(error.retryAfterMs / 1000)
          : undefined;
        res.status(429).json({
          error: error.message,
          model: error.model,
          ...(retryAfterSec !== undefined
            ? { retryAfterSec, retryAfterMs: error.retryAfterMs }
            : {}),
        });
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  return app;
}
