import cors from 'cors';
import express from 'express';
import {
  callLlm,
  generateText,
  listTextModels,
  GeminiQuotaError,
  LlmCapabilityError,
  CallLlmValidationError,
  AgentMaxStepsError,
} from './gemini.js';
import type { CallLlmOptions, ChatMessage, SpeedTier } from '../shared/gemini-types.js';
import type { LandscapeSceneState } from '../shared/scene-agent-types.js';
import type { GenerateTextOptions } from './gemini/generate-text.js';
import { runSceneAgent } from './scene/run-scene-agent.js';

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
      if (error instanceof CallLlmValidationError || error instanceof LlmCapabilityError) {
        res.status(400).json({
          error: error.message,
          ...(error instanceof LlmCapabilityError
            ? { model: error.model, capability: error.capability }
            : {}),
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

  app.post('/api/scene-agent', async (req, res) => {
    try {
      const body = req.body as {
        prompt?: string;
        messages?: ChatMessage[];
        model?: string;
        speedTier?: SpeedTier;
        sceneState: LandscapeSceneState;
        maxSteps?: number;
        debug?: boolean;
      };

      if (!body.sceneState) {
        res.status(400).json({ error: 'sceneState is required.' });
        return;
      }

      if (!body.prompt?.trim() && !body.messages?.length) {
        res.status(400).json({ error: 'prompt or messages are required.' });
        return;
      }

      const result = await runSceneAgent({
        prompt: body.prompt,
        messages: body.messages,
        model: body.model,
        speedTier: body.speedTier,
        sceneState: body.sceneState,
        maxSteps: body.maxSteps,
        debug: body.debug,
      });

      res.json(result);
    } catch (error) {
      if (error instanceof CallLlmValidationError || error instanceof LlmCapabilityError) {
        res.status(400).json({
          error: error.message,
          ...(error instanceof LlmCapabilityError
            ? { model: error.model, capability: error.capability }
            : {}),
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

      if (error instanceof AgentMaxStepsError) {
        res.status(500).json({
          error: error.message,
          failureKind: 'max_steps',
          stepCount: error.steps.length,
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
