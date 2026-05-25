import OpenAI from 'openai';
import { requireGroqApiKey } from '../config.js';

let client: OpenAI | undefined;

export function getGroqClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: requireGroqApiKey(),
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }
  return client;
}

export function resetGroqClient(): void {
  client = undefined;
}
