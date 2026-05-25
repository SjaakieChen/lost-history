import type { CatalogModelDefinition, ThinkingModeKind } from '../../shared/gemini-types.js';

import { defineCatalogModel } from '../llm/catalog-model.js';

import { inferGroqSpeedTier, listGroqTextModels } from '../groq/models-base.js';



/** Base Gemini models (one row per API model) — speed tiers assigned after calibration. */

const GEMINI_BASE_MODELS: CatalogModelDefinition[] = [

  defineCatalogModel({

    id: 'gemini-2.5-flash-lite',

    provider: 'gemini',

    apiModelId: 'gemini-2.5-flash-lite',

    displayName: 'Gemini 2.5 Flash Lite',

    category: 'text',

    supportsThinking: true,

    thinkingMode: 'budget',

    supportsFunctionCalling: true,

    supportsWebSearch: false,

    supportsCodeExecution: false,

    supportsStructuredOutput: false,

    supportsStrictJson: false,

    freeTierAvailable: true,

    rateLimitHints: { rpm: 10, tpm: 250_000, rpd: 20 },

  }),

  defineCatalogModel({

    id: 'gemini-3.1-flash-lite',

    provider: 'gemini',

    apiModelId: 'gemini-3.1-flash-lite',

    displayName: 'Gemini 3.1 Flash Lite',

    category: 'text',

    supportsThinking: true,

    thinkingMode: 'levels',

    supportsFunctionCalling: true,

    supportsWebSearch: false,

    supportsCodeExecution: false,

    supportsStructuredOutput: true,

    supportsStrictJson: true,

    freeTierAvailable: true,

    rateLimitHints: { rpm: 15, tpm: 250_000, rpd: 500 },

  }),

  defineCatalogModel({

    id: 'gemini-2.5-flash',

    provider: 'gemini',

    apiModelId: 'gemini-2.5-flash',

    displayName: 'Gemini 2.5 Flash',

    category: 'text',

    supportsThinking: true,

    thinkingMode: 'budget',

    supportsFunctionCalling: true,

    supportsWebSearch: false,

    supportsCodeExecution: false,

    supportsStructuredOutput: false,

    supportsStrictJson: false,

    freeTierAvailable: true,

    rateLimitHints: { rpm: 5, tpm: 250_000, rpd: 20 },

  }),

  defineCatalogModel({

    id: 'gemini-3.5-flash',

    provider: 'gemini',

    apiModelId: 'gemini-3.5-flash',

    displayName: 'Gemini 3.5 Flash',

    category: 'text',

    supportsThinking: true,

    thinkingMode: 'levels',

    supportsFunctionCalling: true,

    supportsWebSearch: false,

    supportsCodeExecution: false,

    supportsStructuredOutput: true,

    supportsStrictJson: true,

    freeTierAvailable: true,

    rateLimitHints: { rpm: 5, tpm: 250_000, rpd: 20 },

  }),

  defineCatalogModel({

    id: 'gemini-2.5-pro',

    provider: 'gemini',

    apiModelId: 'gemini-2.5-pro',

    displayName: 'Gemini 2.5 Pro',

    category: 'text',

    supportsThinking: true,

    thinkingMode: 'budget',

    supportsFunctionCalling: true,

    supportsWebSearch: false,

    supportsCodeExecution: false,

    supportsStructuredOutput: false,

    supportsStrictJson: false,

    freeTierAvailable: false,

    rateLimitHints: { rpm: 0, tpm: 0, rpd: 0 },

  }),

  defineCatalogModel({

    id: 'gemini-3.1-pro',

    provider: 'gemini',

    apiModelId: 'gemini-3.1-pro-preview',

    displayName: 'Gemini 3.1 Pro',

    category: 'text',

    supportsThinking: true,

    thinkingMode: 'levels',

    supportsFunctionCalling: true,

    supportsWebSearch: false,

    supportsCodeExecution: false,

    supportsStructuredOutput: true,

    supportsStrictJson: true,

    freeTierAvailable: false,

    rateLimitHints: { rpm: 0, tpm: 0, rpd: 0 },

    aliases: ['gemini-3.1-pro-preview'],

  }),

];



const BASE_MODELS: CatalogModelDefinition[] = [...GEMINI_BASE_MODELS, ...listGroqTextModels()];



export function listTextModels(): CatalogModelDefinition[] {

  return BASE_MODELS.filter((model) => model.category === 'text');

}



export function listGeminiTextModels(): CatalogModelDefinition[] {

  return GEMINI_BASE_MODELS.filter((model) => model.category === 'text');

}



export type { CatalogModelDefinition };



export function inferThinkingMode(modelId: string): ThinkingModeKind {

  if (/gemini-2\.5-/.test(modelId)) {

    return 'budget';

  }

  if (/gemini-3/.test(modelId)) {

    return 'levels';

  }

  return 'none';

}



export function inferSpeedTierFromModelId(modelId: string): 'instant' | 'fast' | 'moderate' | 'slow' {

  if (/--/.test(modelId) || modelId.includes('/')) {

    return inferGroqSpeedTier(modelId);

  }

  if (/pro/i.test(modelId)) {

    return 'slow';

  }

  if (/lite/i.test(modelId)) {

    return 'instant';

  }

  return 'moderate';

}

