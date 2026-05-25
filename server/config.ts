import dotenv from 'dotenv';

dotenv.config();

export const GEMINI_DEFAULT_MODEL =
  process.env.GEMINI_DEFAULT_MODEL?.trim() || 'gemini-2.5-flash-lite';

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

export function getGroqApiKey(): string | undefined {
  return process.env.GROQ_API_KEY?.trim() || undefined;
}

export function requireGroqApiKey(): string {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    throw new Error('Add GROQ_API_KEY to .env');
  }
  return apiKey;
}

/** True when at least one LLM provider API key is configured. */
export function hasAnyLlmApiKey(): boolean {
  return Boolean(getApiKey() || getGroqApiKey());
}

export function requireAnyLlmApiKey(): void {
  if (!hasAnyLlmApiKey()) {
    throw new Error('Add GEMINI_API_KEY and/or GROQ_API_KEY to .env');
  }
}
