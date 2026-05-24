import { GoogleGenAI } from '@google/genai';
import { requireApiKey } from '../config.js';

let client: GoogleGenAI | undefined;

export function getGenAIClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: requireApiKey() });
  }
  return client;
}
