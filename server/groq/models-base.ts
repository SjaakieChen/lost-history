import type { CatalogModelDefinition } from '../../shared/gemini-types.js';
import { defineGroqCatalogModel } from '../llm/catalog-model.js';

/** Groq text-generation models (API ids as Groq expects them). */
const GROQ_BASE_MODELS: CatalogModelDefinition[] = [
  defineGroqCatalogModel('openai/gpt-oss-20b', 'GPT-OSS 20B', {
    supportsFunctionCalling: true,
    supportsWebSearch: false,
    supportsCodeExecution: true,
    supportsStructuredOutput: true,
    supportsStrictJson: true,
    freeTierAvailable: true,
  }),
  defineGroqCatalogModel('openai/gpt-oss-120b', 'GPT-OSS 120B', {
    supportsFunctionCalling: true,
    supportsWebSearch: false,
    supportsCodeExecution: true,
    supportsStructuredOutput: true,
    supportsStrictJson: true,
    freeTierAvailable: true,
  }),
  defineGroqCatalogModel('groq/compound-mini', 'Groq Compound Mini', {
    supportsFunctionCalling: false,
    supportsWebSearch: true,
    supportsCodeExecution: true,
    supportsStructuredOutput: true,
    supportsStrictJson: false,
    freeTierAvailable: true,
  }),
  defineGroqCatalogModel('groq/compound', 'Groq Compound', {
    supportsFunctionCalling: false,
    supportsWebSearch: true,
    supportsCodeExecution: true,
    supportsStructuredOutput: true,
    supportsStrictJson: false,
    freeTierAvailable: true,
  }),
  defineGroqCatalogModel('llama-3.1-8b-instant', 'Llama 3.1 8B Instant', {
    supportsFunctionCalling: true,
    supportsWebSearch: false,
    supportsCodeExecution: false,
    supportsStructuredOutput: true,
    supportsStrictJson: false,
    freeTierAvailable: true,
  }),
  defineGroqCatalogModel('llama-3.3-70b-versatile', 'Llama 3.3 70B Versatile', {
    supportsFunctionCalling: true,
    supportsWebSearch: false,
    supportsCodeExecution: false,
    supportsStructuredOutput: true,
    supportsStrictJson: false,
    freeTierAvailable: true,
  }),
  defineGroqCatalogModel('meta-llama/llama-4-scout-17b-16e-instruct', 'Llama 4 Scout 17B', {
    supportsFunctionCalling: true,
    supportsWebSearch: false,
    supportsCodeExecution: false,
    supportsStructuredOutput: true,
    supportsStrictJson: false,
    freeTierAvailable: true,
  }),
  defineGroqCatalogModel('meta-llama/llama-prompt-guard-2-22m', 'Llama Prompt Guard 2 22M', {
    supportsFunctionCalling: false,
    supportsWebSearch: false,
    supportsCodeExecution: false,
    supportsStructuredOutput: false,
    supportsStrictJson: false,
    freeTierAvailable: true,
  }),
  defineGroqCatalogModel('meta-llama/llama-prompt-guard-2-86m', 'Llama Prompt Guard 2 86M', {
    supportsFunctionCalling: false,
    supportsWebSearch: false,
    supportsCodeExecution: false,
    supportsStructuredOutput: false,
    supportsStrictJson: false,
    freeTierAvailable: true,
  }),
  defineGroqCatalogModel('qwen/qwen3-32b', 'Qwen3 32B', {
    supportsFunctionCalling: true,
    supportsWebSearch: false,
    supportsCodeExecution: false,
    supportsStructuredOutput: true,
    supportsStrictJson: false,
    freeTierAvailable: true,
  }),
  defineGroqCatalogModel('allam-2-7b', 'Allam 2 7B', {
    supportsFunctionCalling: false,
    supportsWebSearch: false,
    supportsCodeExecution: false,
    supportsStructuredOutput: false,
    supportsStrictJson: false,
    freeTierAvailable: true,
  }),
];

export function listGroqTextModels(): CatalogModelDefinition[] {
  return GROQ_BASE_MODELS.filter((model) => model.category === 'text');
}

export function listGroqBaseModels(): CatalogModelDefinition[] {
  return GROQ_BASE_MODELS;
}

export function inferGroqSpeedTier(modelId: string): 'instant' | 'fast' | 'moderate' | 'slow' {
  if (/compound-mini/i.test(modelId)) {
    return 'instant';
  }
  if (/compound(?!-mini)/i.test(modelId)) {
    return 'fast';
  }
  if (/120b/i.test(modelId)) {
    return 'moderate';
  }
  if (/instant|8b|22m/i.test(modelId)) {
    return 'instant';
  }
  if (/prompt-guard/i.test(modelId)) {
    return 'fast';
  }
  if (/70b|32b/i.test(modelId)) {
    return 'moderate';
  }
  return 'moderate';
}
