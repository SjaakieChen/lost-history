import cors from 'cors';
import express from 'express';
import {
  callLlm,
  generateText,
  listTextModels,
  GeminiQuotaError,
  LlmCapabilityError,
} from './gemini.js';
import type { CallLlmOptions, GenerateTextOptions } from '../shared/gemini-types.js';

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

      if (!body.contents?.length && !body.prompt?.trim() && !body.messages?.length) {
        res.status(400).json({ error: 'contents, prompt, or messages are required.' });
        return;
      }

      const result = await callLlm(body);
      res.json(result);
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
        res.status(429).json({ error: error.message, model: error.model });
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
        temperature: body.temperature,
        maxOutputTokens: body.maxOutputTokens,
        thinking: body.thinking,
        thinkingBudget: body.thinkingBudget,
        includeThoughts: body.includeThoughts,
        thinkingPower: body.thinkingPower,
        thinkingPowerTier: body.thinkingPowerTier,
      });

      res.json(result);
    } catch (error) {
      if (error instanceof GeminiQuotaError) {
        res.status(429).json({ error: error.message, model: error.model });
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: message });
    }
  });

  return app;
}
