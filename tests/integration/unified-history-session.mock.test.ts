import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetExhaustionState } from '../../server/gemini/availability.js';
import { getGroqClient } from '../../server/groq/client.js';
import { LlmSession } from '../../server/llm/session.js';
import {
  assertGroqFollowUpPayload,
  assertUnifiedCallOutput,
  assistantMessages,
  combinedAssistantContent,
} from '../helpers/capability-output-expectations.js';
import {
  groqCodeExecutionResponse,
  groqTextResponse,
  installGroqClientMock,
} from '../helpers/mock-groq.js';

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

vi.mock('../../server/groq/client.js', () => ({
  getGroqClient: vi.fn(),
}));

describe('unified history — LlmSession (offline)', () => {
  beforeEach(() => {
    resetExhaustionState();
    vi.clearAllMocks();
    process.env.GROQ_API_KEY = 'test-groq-key';
  });

  it('two Groq turns: session export accumulates tags; second API call keeps native fields', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(groqCodeExecutionResponse('426758565'))
      .mockResolvedValueOnce(groqTextResponse('426758565'));
    vi.mocked(getGroqClient).mockReturnValue(installGroqClientMock(create) as never);

    const session = new LlmSession({
      model: 'openai/gpt-oss-20b',
      capabilities: { codeExecution: true },
      maxOutputTokens: 128,
    });

    const first = await session.send({ prompt: '98765 * 4321 integer only' });
    assertUnifiedCallOutput(first, session.exportMessages(), {
      executedToolsMin: 1,
      assistantTags: ['code_execution'],
      userPromptInTranscript: '98765',
    });

    const second = await session.send({ prompt: 'Repeat the integer only' });
    expect(second.text).toMatch(/426758565/);

    const exported = session.exportMessages();
    expect(exported.filter((message) => message.role === 'user')).toHaveLength(2);
    expect(assistantMessages(exported).length).toBe(2);
    expect(combinedAssistantContent(exported).match(/<code_execution>/g)?.length).toBeGreaterThanOrEqual(
      1,
    );

    const secondPayload = create.mock.calls[1][0] as { messages?: unknown[] };
    assertGroqFollowUpPayload(secondPayload, 'gpt-oss-followup');
  });

  it('session stores thoughts on assistant turn when Groq returns reasoning', async () => {
    const create = vi.fn().mockResolvedValue(
      groqTextResponse('done', { reasoning: 'internal trace', model: 'groq/compound-mini' }),
    );
    vi.mocked(getGroqClient).mockReturnValue(installGroqClientMock(create) as never);

    const session = new LlmSession({
      model: 'groq/compound-mini',
      capabilities: { webSearch: true },
      prompt: 'date?',
    });
    await session.send();

    const assistant = assistantMessages(session.exportMessages()).at(-1);
    expect(assistant?.thoughts).toContain('internal');
    expect(assistant?.model).toMatch(/^groq--compound/);
  });

  it('session export after two turns: user prompts and models preserved per assistant line', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(groqTextResponse('one'))
      .mockResolvedValueOnce(groqTextResponse('two'));
    vi.mocked(getGroqClient).mockReturnValue(installGroqClientMock(create) as never);

    const session = new LlmSession({ model: 'groq/compound-mini', prompt: 'First' });
    await session.send();
    await session.send({ prompt: 'Second' });

    const history = session.getModelHistory();
    expect(history.map((turn) => turn.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(history[1].content).toContain('one');
    expect(history[3].content).toContain('two');
    expect(history[1].model).toMatch(/^groq--compound/);
    expect(history[3].model).toMatch(/^groq--compound/);
  });
});
