import dotenv from 'dotenv';

dotenv.config();

export const GEMINI_MODEL = 'gemini-2.5-flash';

export function getApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
}

export function requireApiKey(): string {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Add GEMINI_API_KEY to .env');
  }
  return apiKey;
}
