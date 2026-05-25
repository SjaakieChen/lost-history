import dotenv from 'dotenv';

import { getApiKey } from '../server/config.js';

import type { TextModelInfo } from '../shared/gemini-types.js';

import { callLlm, getModelsBySpeedTier } from '../server/gemini.js';

dotenv.config();

const TEST_MODEL = 'gemini-3.5-flash-minimal';

async function main() {
  const apiKey = getApiKey();

  if (!apiKey) {
    console.error('Add GEMINI_API_KEY to .env');
    process.exit(1);
  }

  console.log(`Testing callLlm (${TEST_MODEL}, text only)...`);

  const result = await callLlm({
    model: TEST_MODEL,
    prompt: 'Reply with one word: hello',
    maxOutputTokens: 16,
  });

  console.log('Success!');
  console.log(`Model: ${result.model}`);
  console.log(`Thinking used: ${result.thinkingUsed} (${result.thinkingPowerApplied})`);
  if (result.usage) {
    console.log(`Usage: ${JSON.stringify(result.usage)}`);
  }
  console.log('Response:', result.text);

  const instantTier = getModelsBySpeedTier('instant').map((model: TextModelInfo) => model.id);
  console.log(`Instant-tier registry entries: ${instantTier.join(', ')}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Test failed: ${message}`);
  process.exit(1);
});
