import type { GenerateContentResponse } from '@google/genai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetExhaustionState } from '../../server/gemini/availability.js';
import { callLlm } from '../../server/gemini/call-llm.js';
import { getGenAIClient } from '../../server/gemini/client.js';
import { getGroqClient } from '../../server/groq/client.js';
import {
  assertUnifiedCallOutput,
  combinedAssistantContent,
} from '../helpers/capability-output-expectations.js';
import {
  groqCodeExecutionResponse,
  groqTextResponse,
  groqWebSearchResponse,
  installGroqClientMock,
} from '../helpers/mock-groq.js';
import { createFunctionCallResponse, createTextResponse } from '../helpers/mock-genai.js';

vi.mock('../../server/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/config.js')>();
  return {
    ...actual,
    getGroqApiKey: vi.fn(() => 'test-groq-key'),
  };
});

vi.mock('../../server/gemini/rate-limit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/gemini/rate-limit.js')>();
  return {
    ...actual,
    withRateLimitAndRetry: vi.fn((_key, _hints, operation: () => Promise<unknown>) => operation()),
  };
});

vi.mock('../../server/gemini/client.js', () => ({
  getGenAIClient: vi.fn(),
}));

vi.mock('../../server/groq/client.js', () => ({
  getGroqClient: vi.fn(),
}));

function installGemini(generateContent: ReturnType<typeof vi.fn>) {
  vi.mocked(getGenAIClient).mockReturnValue({
    models: { get: vi.fn().mockResolvedValue({}), generateContent },
  } as never);
}

function installGroq(create: ReturnType<typeof vi.fn>) {
  vi.mocked(getGroqClient).mockReturnValue(installGroqClientMock(create) as never);
}

describe('unified history — callLlm result fields (offline)', () => {
  beforeEach(() => {
    resetExhaustionState();
    vi.clearAllMocks();
    process.env.GROQ_API_KEY = 'test-groq-key';
  });

  it('plain Gemini text: thoughts absent, no specialist tags, messages user+assistant', async () => {
    installGemini(vi.fn().mockResolvedValue(createTextResponse('Hello')));

    const result = await callLlm({
      model: 'gemini-3.5-flash',
      prompt: 'Hi',
    });

    assertUnifiedCallOutput(result, result.messages ?? [], {
      registryPattern: /^gemini/,
      text: 'Hello',
      expectNoThoughts: true,
      expectNoExecutedTools: true,
      expectNoAssistantTags: ['web_search', 'code_execution', 'tool_call'],
      messagesLength: 2,
      userPromptInTranscript: 'Hi',
    });
  });

  it('Gemini webSearch: grounding → executedTools + web_search tag, not in text alone', async () => {
    installGemini(
      vi.fn().mockResolvedValue(
        createTextResponse('News on May 20.', {
          candidates: [
            {
              finishReason: 'STOP',
              content: { role: 'model', parts: [{ text: 'News on May 20.' }] },
              groundingMetadata: {
                webSearchQueries: ['news May 2026'],
                groundingChunks: [{ web: { uri: 'https://news.test', title: 'News' } }],
              },
            },
          ],
        } as GenerateContentResponse),
      ),
    );

    const result = await callLlm({
      model: 'gemini-3.5-flash',
      capabilities: { webSearch: true },
      prompt: 'Latest news',
    });

    assertUnifiedCallOutput(result, result.messages ?? [], {
      registryPattern: /^gemini/,
      text: /News/,
      executedToolsMin: 1,
      executedToolMatcher: (tools) =>
        (tools[0].searchQueries?.length ?? 0) > 0 && (tools[0].searchResults?.length ?? 0) > 0,
      assistantTags: ['web_search'],
      expectNoAssistantTags: ['code_execution', 'tool_call'],
      userPromptInTranscript: 'Latest news',
    });
    expect(result.messages?.[1].content).toMatch(/<web_search>[\s\S]*https:\/\/news\.test/);
  });

  it('Gemini tools: functionCalls on result, tool_call in transcript, text may be empty', async () => {
    installGemini(vi.fn().mockResolvedValue(createFunctionCallResponse('pick_number', {})));

    const result = await callLlm({
      model: 'gemini-3.5-flash',
      capabilities: { tools: true },
      tools: [{ name: 'pick_number', description: 'pick', parameters: {} }],
      functionCallingMode: 'ANY',
      prompt: 'Pick',
    });

    assertUnifiedCallOutput(result, result.messages ?? [], {
      functionCalls: ['pick_number'],
      assistantTags: ['tool_call'],
      expectNoAssistantTags: ['web_search', 'code_execution'],
      expectNoExecutedTools: true,
    });
  });

  it('Groq Compound webSearch: search in executedTools + tag, reasoning → thoughts', async () => {
    const create = vi.fn().mockResolvedValue(groqWebSearchResponse());
    installGroq(create);

    const result = await callLlm({
      model: 'groq/compound-mini',
      capabilities: { webSearch: true },
      prompt: 'UTC date?',
    });

    assertUnifiedCallOutput(result, result.messages ?? [], {
      registryPattern: /^groq--compound/,
      text: /May|2026|\d/,
      thoughts: /search/i,
      executedToolsMin: 1,
      executedToolMatcher: (tools) => (tools[0].searchResults?.length ?? 0) > 0,
      assistantTags: ['web_search'],
      expectNoAssistantTags: ['code_execution'],
      expectNoFunctionCalls: true,
    });
    expect(create).toHaveBeenCalledWith(
      expect.not.objectContaining({
        tools: expect.arrayContaining([{ type: 'code_interpreter' }]),
      }),
    );
  });

  it('Groq GPT-OSS codeExecution: code_interpreter request, code tag + executedTools', async () => {
    const create = vi.fn().mockResolvedValue(groqCodeExecutionResponse());
    installGroq(create);

    const result = await callLlm({
      model: 'openai/gpt-oss-20b',
      capabilities: { codeExecution: true },
      prompt: '98765 * 4321 integer only',
    });

    assertUnifiedCallOutput(result, result.messages ?? [], {
      registryPattern: /^openai--gpt-oss/,
      text: /426758565/,
      thoughts: /python/i,
      executedToolsMin: 1,
      assistantTags: ['code_execution'],
      expectNoAssistantTags: ['web_search', 'tool_call'],
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [{ type: 'code_interpreter' }],
        tool_choice: 'required',
      }),
    );
  });

  it('Groq Compound codeExecution: no code_interpreter in request, still gets code tag', async () => {
    const create = vi.fn().mockResolvedValue(
      groqTextResponse('426758565', {
        model: 'groq/compound',
        reasoning: '<tool>python(...)</tool>',
        executed_tools: [
          { type: 'python', output: '426758565', arguments: '{"code":"print(98765*4321)"}' },
        ],
      }),
    );
    installGroq(create);

    const result = await callLlm({
      model: 'groq/compound',
      capabilities: { codeExecution: true },
      prompt: 'multiply',
    });

    assertUnifiedCallOutput(result, result.messages ?? [], {
      registryPattern: /^groq--compound/,
      executedToolsMin: 1,
      assistantTags: ['code_execution'],
    });
    const payload = create.mock.calls[0][0] as { tools?: unknown[] };
    expect(payload.tools ?? []).not.toEqual(
      expect.arrayContaining([{ type: 'code_interpreter' }]),
    );
  });

  it('cross-provider chain: Groq code transcript imported into Gemini sees code context', async () => {
    const groqCreate = vi.fn().mockResolvedValue(groqCodeExecutionResponse('999'));
    installGroq(groqCreate);

    const first = await callLlm({
      model: 'groq/compound',
      capabilities: { codeExecution: true },
      prompt: 'Run code',
    });

    assertUnifiedCallOutput(first, first.messages ?? [], {
      assistantTags: ['code_execution'],
    });

    const generateContent = vi.fn().mockResolvedValue(createTextResponse('999'));
    installGemini(generateContent);

    const second = await callLlm({
      model: 'gemini-3.5-flash',
      messages: [
        ...(first.messages ?? []),
        { role: 'user', content: 'What integer did you compute? Digits only.' },
      ],
    });

    const geminiPayload = generateContent.mock.calls[0][0] as { contents: Array<{ parts?: unknown[] }> };
    const blob = JSON.stringify(geminiPayload.contents);
    expect(blob).toMatch(/code_execution|426758565|999|Code execution/i);

    assertUnifiedCallOutput(second, second.messages ?? [], {
      registryPattern: /^gemini/,
      text: '999',
      expectNoExecutedTools: true,
      messagesLength: 2,
    });
  });

  it('Groq → Groq failover: rebuilt transcript preserves code_execution for follow-up', async () => {
    const { quotaError } = await import('../helpers/mock-genai.js');
    let callIndex = 0;
    const groqCreate = vi.fn().mockImplementation(() => {
      callIndex += 1;
      if (callIndex === 1) {
        return Promise.resolve(groqCodeExecutionResponse('111'));
      }
      if (callIndex === 2) {
        return Promise.reject(quotaError());
      }
      return Promise.resolve(groqTextResponse('111'));
    });

    installGroq(groqCreate);

    const first = await callLlm({
      model: 'groq/compound',
      capabilities: { codeExecution: true },
      prompt: 'Compute',
    });

    const second = await callLlm({
      model: 'groq/compound',
      capabilities: { codeExecution: true },
      messages: [
        ...(first.messages ?? []),
        { role: 'user', content: 'Repeat the integer only' },
      ],
    });

    expect(second.modelsAttempted?.length).toBeGreaterThan(1);
    const followUpPayload = groqCreate.mock.calls.at(-1)?.[0] as {
      messages?: Array<Record<string, unknown>>;
    };
    const historyBlob = JSON.stringify(followUpPayload?.messages ?? []);
    expect(historyBlob).toMatch(/code_execution|111|Compute/);
    assertUnifiedCallOutput(second, second.messages ?? [], {
      text: '111',
    });
    expect(combinedAssistantContent(first.messages ?? [])).toContain('<code_execution');
  });
});
