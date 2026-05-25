import type { TextModelInfo } from '../../shared/gemini-types.js';

type GroqBaseModel = Omit<
  TextModelInfo,
  'strengthRank' | 'speedTier' | 'bakedThinkingPower' | 'provider'
> & { provider: 'groq' };

function groqModel(
  apiModelId: string,
  displayName: string,
  options: {
    supportsFunctionCalling?: boolean;
    supportsStructuredOutput?: boolean;
    rateLimitHints?: { rpm?: number; tpm?: number; rpd?: number };
    aliases?: string[];
    category?: TextModelInfo['category'];
  } = {},
): GroqBaseModel {
  const slug = apiModelId.replace(/\//g, '--');
  return {
    id: slug,
    apiModelId,
    displayName,
    category: options.category ?? 'text',
    provider: 'groq',
    supportsThinking: false,
    thinkingMode: 'none',
    supportsFunctionCalling: options.supportsFunctionCalling ?? true,
    supportsStructuredOutput: options.supportsStructuredOutput ?? false,
    freeTierAvailable: true,
    rateLimitHints: options.rateLimitHints ?? { rpm: 30, tpm: 0, rpd: 0 },
    aliases: [apiModelId, ...(options.aliases ?? [])],
  };
}

/** Groq text-generation models (API ids as Groq expects them). */
const GROQ_BASE_MODELS: GroqBaseModel[] = [
  groqModel('allam-2-7b', 'Allam 2 7B', { supportsFunctionCalling: false }),
  groqModel('canopylabs/orpheus-arabic-saudi', 'Orpheus Arabic Saudi', {
    category: 'tts',
    supportsFunctionCalling: false,
  }),
  groqModel('canopylabs/orpheus-v1-english', 'Orpheus English v1', {
    category: 'tts',
    supportsFunctionCalling: false,
  }),
  groqModel('groq/compound', 'Groq Compound', { supportsFunctionCalling: false }),
  groqModel('groq/compound-mini', 'Groq Compound Mini', { supportsFunctionCalling: false }),
  groqModel('llama-3.1-8b-instant', 'Llama 3.1 8B Instant'),
  groqModel('llama-3.3-70b-versatile', 'Llama 3.3 70B Versatile'),
  groqModel('meta-llama/llama-4-scout-17b-16e-instruct', 'Llama 4 Scout 17B'),
  groqModel('meta-llama/llama-prompt-guard-2-22m', 'Llama Prompt Guard 2 22M', {
    supportsFunctionCalling: false,
  }),
  groqModel('meta-llama/llama-prompt-guard-2-86m', 'Llama Prompt Guard 2 86M', {
    supportsFunctionCalling: false,
  }),
  groqModel('openai/gpt-oss-120b', 'GPT-OSS 120B'),
  groqModel('openai/gpt-oss-20b', 'GPT-OSS 20B'),
  groqModel('openai/gpt-oss-safeguard-20b', 'GPT-OSS Safeguard 20B'),
  groqModel('qwen/qwen3-32b', 'Qwen3 32B'),
];

export function listGroqTextModels(): GroqBaseModel[] {
  return GROQ_BASE_MODELS.filter((model) => model.category === 'text');
}

export function listGroqBaseModels(): GroqBaseModel[] {
  return GROQ_BASE_MODELS;
}

export function inferGroqSpeedTier(modelId: string): 'instant' | 'fast' | 'moderate' | 'slow' {
  if (/instant|8b|mini|compound-mini|22m/i.test(modelId)) {
    return 'instant';
  }
  if (/70b|32b|120b|compound(?!-mini)/i.test(modelId)) {
    return 'moderate';
  }
  if (/prompt-guard|safeguard/i.test(modelId)) {
    return 'fast';
  }
  return 'moderate';
}
