import dotenv from 'dotenv';
import { getApiKey } from '../server/config.js';
import { callLlm, getModelsByTier } from '../server/gemini.js';

dotenv.config();

/** Cheap model for smoke tests — avoids hammering rate-limited defaults. */
const TEST_MODEL = 'gemini-2.5-flash-lite';

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
    thinkingPower: 'off',
    maxOutputTokens: 16,
  });

  console.log('Success!');
  console.log(`Model: ${result.model}`);
  console.log(`Thinking used: ${result.thinkingUsed} (${result.thinkingPowerApplied})`);
  if (result.usage) {
    console.log(`Usage: ${JSON.stringify(result.usage)}`);
  }
  console.log('Response:', result.text);

  const lowTier = getModelsByTier('low').map((model) => model.id);
  console.log(`Low-tier models in registry: ${lowTier.join(', ')}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Test failed: ${message}`);
  process.exit(1);
});
