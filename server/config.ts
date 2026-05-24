import dotenv from 'dotenv';

dotenv.config();

export const GEMINI_DEFAULT_MODEL =
  process.env.GEMINI_DEFAULT_MODEL?.trim() || 'gemini-2.5-flash-lite';

/** @deprecated Use GEMINI_DEFAULT_MODEL */
export const GEMINI_MODEL = GEMINI_DEFAULT_MODEL;

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
