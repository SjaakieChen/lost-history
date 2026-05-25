import { describe, expect, it } from 'vitest';
import type { CatalogModelDefinition, ModelCapabilityLabels } from '../../shared/gemini-types.js';
import { defineGroqCatalogModel } from '../../server/llm/catalog-model.js';
import { listGeminiTextModels, listTextModels } from '../../server/gemini/models-base.js';
import { listGroqBaseModels } from '../../server/groq/models-base.js';

const CAPABILITY_LABEL_KEYS: (keyof ModelCapabilityLabels)[] = [
  'supportsThinking',
  'thinkingMode',
  'supportsFunctionCalling',
  'supportsWebSearch',
  'supportsCodeExecution',
  'supportsStructuredOutput',
  'supportsStrictJson',
  'freeTierAvailable',
];

function assertCapabilityLabels(model: CatalogModelDefinition): void {
  for (const key of CAPABILITY_LABEL_KEYS) {
    const value = model[key];
    if (key === 'thinkingMode') {
      expect(typeof value).toBe('string');
      expect(['none', 'budget', 'levels']).toContain(value);
    } else {
      expect(typeof value).toBe('boolean');
    }
  }
}

describe('defineGroqCatalogModel', () => {
  it('requires explicit capability labels at compile time', () => {
    // @ts-expect-error specialist capability labels must be declared explicitly
    defineGroqCatalogModel('test/model', 'Test', {
      supportsStructuredOutput: false,
      supportsStrictJson: false,
      freeTierAvailable: true,
    });
  });
});

describe('catalog model capability labels', () => {
  it('every Gemini catalog row declares all capability labels', () => {
    for (const model of listGeminiTextModels()) {
      assertCapabilityLabels(model);
    }
  });

  it('every Groq catalog row declares all capability labels', () => {
    for (const model of listGroqBaseModels()) {
      assertCapabilityLabels(model);
    }
  });

  it('every text catalog row declares all capability labels', () => {
    expect(listTextModels().length).toBeGreaterThan(0);
    for (const model of listTextModels()) {
      assertCapabilityLabels(model);
    }
  });
});
