import dotenv from 'dotenv';
import { GEMINI_MODEL, getApiKey } from '../server/config.js';
import { generateText } from '../server/gemini.js';

dotenv.config();

async function main() {
  const apiKey = getApiKey();

  if (!apiKey) {
    console.error('Add GEMINI_API_KEY to .env');
    process.exit(1);
  }

  console.log(`Testing Gemini API (${GEMINI_MODEL})...`);

  const text = await generateText('Say hello in one short sentence.');

  console.log('Success! Response:');
  console.log(text);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Test failed: ${message}`);
  process.exit(1);
});
