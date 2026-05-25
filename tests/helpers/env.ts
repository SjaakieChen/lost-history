import { getApiKey, getGroqApiKey } from '../../server/config.js';

export function hasLiveApiKey(): boolean {
  return Boolean(getApiKey());
}

/** Live tests need both providers for speed-tier routing (Gemini + Groq). */
export function hasLiveTestKeys(): boolean {
  return Boolean(getApiKey() && getGroqApiKey());
}

export function hasGeminiLiveKey(): boolean {
  return Boolean(getApiKey());
}

export function hasGroqLiveKey(): boolean {
  return Boolean(getGroqApiKey());
}
