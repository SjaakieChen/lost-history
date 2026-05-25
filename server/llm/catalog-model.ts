import type {
  CatalogModelDefinition,
  ModelCapabilityLabels,
  ModelCategory,
  ModelRateLimitHints,
} from '../../shared/gemini-types.js';

/** Compile-time guard: every catalog row must declare routing capability labels explicitly. */
export function defineCatalogModel<T extends CatalogModelDefinition>(model: T): T {
  return model;
}

/** Groq catalog rows use fixed thinking; callers supply specialist capability labels explicitly. */
export type GroqCatalogCapabilities = Required<
  Pick<
    ModelCapabilityLabels,
    | 'supportsFunctionCalling'
    | 'supportsWebSearch'
    | 'supportsCodeExecution'
    | 'supportsStructuredOutput'
    | 'supportsStrictJson'
    | 'freeTierAvailable'
  >
>;

export interface GroqCatalogModelOptions extends GroqCatalogCapabilities {
  category?: ModelCategory;
  rateLimitHints?: ModelRateLimitHints;
  aliases?: string[];
}

export function defineGroqCatalogModel(
  apiModelId: string,
  displayName: string,
  options: GroqCatalogModelOptions,
): CatalogModelDefinition {
  const slug = apiModelId.replace(/\//g, '--');
  return {
    id: slug,
    apiModelId,
    displayName,
    category: options.category ?? 'text',
    provider: 'groq',
    supportsThinking: false,
    thinkingMode: 'none',
    supportsFunctionCalling: options.supportsFunctionCalling,
    supportsWebSearch: options.supportsWebSearch,
    supportsCodeExecution: options.supportsCodeExecution,
    supportsStructuredOutput: options.supportsStructuredOutput,
    supportsStrictJson: options.supportsStrictJson,
    freeTierAvailable: options.freeTierAvailable,
    rateLimitHints: options.rateLimitHints ?? { rpm: 30, tpm: 0, rpd: 0 },
    aliases: [apiModelId, ...(options.aliases ?? [])],
  };
}
