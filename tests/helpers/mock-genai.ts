import type { GenerateContentResponse } from '@google/genai';
import { vi } from 'vitest';

export function createTextResponse(
  text: string,
  overrides: Partial<GenerateContentResponse> = {},
): GenerateContentResponse {
  return {
    text,
    modelVersion: 'models/gemini-2.5-flash-lite',
    candidates: [
      {
        finishReason: 'STOP',
        content: {
          role: 'model',
          parts: [{ text }],
        },
      },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    },
    ...overrides,
  } as GenerateContentResponse;
}

export function createThoughtResponse(thought: string, text: string): GenerateContentResponse {
  return {
    text,
    modelVersion: 'models/gemini-2.5-flash-lite',
    candidates: [
      {
        finishReason: 'STOP',
        content: {
          role: 'model',
          parts: [
            { text: thought, thought: true },
            { text },
          ],
        },
      },
    ],
  } as GenerateContentResponse;
}

export function createFunctionCallsResponse(
  calls: Array<{ name: string; args?: Record<string, unknown>; id?: string }>,
): GenerateContentResponse {
  return {
    modelVersion: 'models/gemini-2.5-flash-lite',
    candidates: [
      {
        finishReason: 'STOP',
        content: {
          role: 'model',
          parts: calls.map((call, index) => ({
            functionCall: {
              id: call.id ?? `fc-${index + 1}`,
              name: call.name,
              args: call.args ?? {},
            },
          })),
        },
      },
    ],
  } as GenerateContentResponse;
}

export function createFunctionCallResponse(
  name: string,
  args: Record<string, unknown> = {},
  id = 'fc-1',
): GenerateContentResponse {
  return createFunctionCallsResponse([{ name, args, id }]);
}

export function quotaError(message = 'rate limit', status = 429): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

export interface MockGenAIClientWithGet {
  generateContent: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}

export function createMockGenAIWithGet(options: {
  getResult?: unknown | Error;
  generateResult?: GenerateContentResponse | Error;
  getImpl?: ReturnType<typeof vi.fn>;
  generateImpl?: ReturnType<typeof vi.fn>;
}): MockGenAIClientWithGet {
  const get =
    options.getImpl ??
    vi.fn().mockImplementation(() => {
      if (options.getResult instanceof Error) {
        return Promise.reject(options.getResult);
      }
      return Promise.resolve(options.getResult ?? { name: 'mock-model' });
    });

  const generateContent =
    options.generateImpl ??
    vi.fn().mockImplementation(() => {
      if (options.generateResult instanceof Error) {
        return Promise.reject(options.generateResult);
      }
      return Promise.resolve(options.generateResult ?? createTextResponse('ok'));
    });

  return { get, generateContent };
}

export function installMockGenAIWithGet(options: Parameters<typeof createMockGenAIWithGet>[0]) {
  const mock = createMockGenAIWithGet(options);
  return {
    mock,
    genAIStub: {
      models: {
        get: mock.get,
        generateContent: mock.generateContent,
      },
    },
  };
}

export interface MockGenAIClient {
  generateContent: ReturnType<typeof vi.fn>;
}

export function createMockGenAIClient(
  response: GenerateContentResponse | Error,
): MockGenAIClient {
  const generateContent = vi.fn();

  if (response instanceof Error) {
    generateContent.mockRejectedValue(response);
  } else {
    generateContent.mockResolvedValue(response);
  }

  return { generateContent };
}

export function installMockGenAIClient(response: GenerateContentResponse | Error) {
  const mockClient = createMockGenAIClient(response);

  return {
    mockClient,
    genAIStub: {
      models: {
        generateContent: mockClient.generateContent,
      },
    },
  };
}
