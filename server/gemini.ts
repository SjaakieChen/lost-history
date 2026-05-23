import { GoogleGenAI } from '@google/genai';
import { GEMINI_MODEL, requireApiKey } from './config.js';

export async function generateText(prompt: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: requireApiKey() });

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
  });

  return response.text ?? 'No response text received.';
}
