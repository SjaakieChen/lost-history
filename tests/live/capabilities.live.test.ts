import dotenv from 'dotenv';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetExhaustionState } from '../../server/gemini/availability.js';
import { LlmSession } from '../../server/llm/session.js';
import { hasGeminiLiveKey, hasGroqLiveKey } from '../helpers/env.js';
import { callLlmLive } from '../helpers/live-call.js';
import { assertCapabilityTranscript } from '../helpers/live-capability-expectations.js';
import {
  finalizeFixtureRun,
  isRecordingFixtures,
  recordSingleCallFixture,
  resetFixtureRecordingState,
  SessionFixtureRecorder,
} from '../helpers/live-fixture-record.js';
import {
  LIVE_COUNTRY_SCHEMA,
  LIVE_GEMINI_STRUCTURED_MODEL,
  LIVE_GEMINI_TOOLS_MODEL,
  LIVE_GEMINI_WEB_SEARCH_MODEL,
  LIVE_GROQ_CODE_EXECUTION_MODEL,
  LIVE_GROQ_CODE_EXECUTION_OSS_MODEL,
  LIVE_GROQ_STRICT_JSON_MODEL,
  LIVE_GROQ_STRUCTURED_JSON_MODEL,
  LIVE_GROQ_TOOLS_MODEL,
  LIVE_GROQ_WEB_SEARCH_MODEL,
  LIVE_PICK_NUMBER_TOOL,
  parseJsonFromModelText,
} from '../helpers/live-capabilities.js';
import { logLiveCallError, logLiveCallResult } from '../helpers/live-log.js';

dotenv.config();

beforeAll(() => {
  if (isRecordingFixtures()) {
    resetFixtureRecordingState();
  }
});

afterAll(() => {
  finalizeFixtureRun();
});

const WEB_SEARCH_PROMPT_GEMINI =
  'Using web search if needed: name one specific news event reported within the last 7 days. Reply in 2–4 sentences with the event and approximate date.';

const WEB_SEARCH_PROMPT_GROQ =
  "Use web search: what is today's calendar date in UTC? Reply in one short sentence only.";

const CODE_EXECUTION_PROMPT =
  'What is 98765 multiplied by 4321? Use code execution. Reply with only the integer result.';

const PRODUCT_DIGITS = /426758565|426763565/;

function productInText(text: string): boolean {
  return PRODUCT_DIGITS.test(text.replace(/\D/g, ''));
}

/** Live = smoke that APIs respond; field placement is covered offline in unified-history-*.mock.test.ts */
describe.skipIf(!hasGeminiLiveKey())('LLM live — Gemini capabilities (smoke)', () => {
  beforeEach(() => {
    resetExhaustionState();
  });

  it('webSearch', async () => {
    const callOptions = {
      model: LIVE_GEMINI_WEB_SEARCH_MODEL,
      capabilities: { webSearch: true } as const,
      prompt: WEB_SEARCH_PROMPT_GEMINI,
      maxOutputTokens: 512,
    };
    const result = await callLlmLive(callOptions);
    recordSingleCallFixture({
      scenarioId: 'gemini-webSearch',
      provider: 'gemini',
      callOptions,
      result,
    });
    logLiveCallResult('gemini / webSearch', result);
    assertCapabilityTranscript({
      result,
      messages: result.messages ?? [],
      registryPattern: /^gemini/,
      text: (text) => text.trim().length > 20,
    });
  }, 120_000);

  it('tools', async () => {
    const session = new LlmSession({
      model: LIVE_GEMINI_TOOLS_MODEL,
      capabilities: { tools: true },
      tools: [LIVE_PICK_NUMBER_TOOL],
      functionCallingMode: 'ANY',
      prompt: 'Call pick_number once then say the number.',
      maxOutputTokens: 256,
    });
    const recorder = new SessionFixtureRecorder('gemini-tools-session', session, 'gemini');
    const result = await session.send();
    recorder.addStep(result);
    recorder.finish();
    logLiveCallResult('gemini / tools', result);
    assertCapabilityTranscript({
      result,
      messages: session.exportMessages(),
      registryPattern: /^gemini/,
      functionCalls: ['pick_number'],
      assistantTags: ['tool_call'],
    });
  }, 90_000);

  it('structuredJson', async () => {
    const callOptions = {
      model: LIVE_GEMINI_STRUCTURED_MODEL,
      capabilities: { structuredJson: true } as const,
      structuredOutput: LIVE_COUNTRY_SCHEMA,
      prompt: 'Return JSON for France.',
      maxOutputTokens: 256,
    };
    const result = await callLlmLive(callOptions);
    recordSingleCallFixture({
      scenarioId: 'gemini-structuredJson',
      provider: 'gemini',
      callOptions,
      result,
    });
    logLiveCallResult('gemini / structuredJson', result);
    const parsed = parseJsonFromModelText(result.text) as { capital?: string };
    expect(parsed.capital?.toLowerCase()).toContain('paris');
  }, 90_000);
});

describe.skipIf(!hasGroqLiveKey())('LLM live — Groq capabilities (smoke)', () => {
  beforeEach(() => {
    resetExhaustionState();
  });

  it('webSearch', async () => {
    const callOptions = {
      model: LIVE_GROQ_WEB_SEARCH_MODEL,
      capabilities: { webSearch: true } as const,
      prompt: WEB_SEARCH_PROMPT_GROQ,
      maxOutputTokens: 256,
    };
    const result = await callLlmLive(callOptions);
    recordSingleCallFixture({
      scenarioId: 'groq-webSearch',
      provider: 'groq',
      callOptions,
      result,
    });
    logLiveCallResult('groq / webSearch', result);
    assertCapabilityTranscript({
      result,
      messages: result.messages ?? [],
      registryPattern: /^groq--compound/,
      text: /\d|may/i,
    });
  }, 120_000);

  it('codeExecution Compound', async () => {
    const callOptions = {
      model: LIVE_GROQ_CODE_EXECUTION_MODEL,
      capabilities: { codeExecution: true } as const,
      prompt: CODE_EXECUTION_PROMPT,
      maxOutputTokens: 256,
    };
    const result = await callLlmLive(callOptions);
    recordSingleCallFixture({
      scenarioId: 'groq-codeExecution-compound',
      provider: 'groq',
      callOptions,
      result,
    });
    logLiveCallResult('groq / codeExecution / compound', result);
    expect(
      productInText(result.text) || PRODUCT_DIGITS.test(JSON.stringify(result.executedTools ?? [])),
    ).toBe(true);
  }, 120_000);

  it('codeExecution GPT-OSS + session memory', async () => {
    const session = new LlmSession({
      model: LIVE_GROQ_CODE_EXECUTION_OSS_MODEL,
      capabilities: { codeExecution: true },
      maxOutputTokens: 256,
    });
    const recorder = new SessionFixtureRecorder(
      'groq-codeExecution-gpt-oss-session',
      session,
      'groq',
    );
    const first = await session.send({ prompt: CODE_EXECUTION_PROMPT });
    recorder.addStep(first);
    const second = await session.send({ prompt: 'Repeat the integer product. Digits only.' });
    recorder.addStep(second);
    recorder.finish();
    logLiveCallResult('groq / codeExecution / gpt-oss', second);
    expect(productInText(second.text)).toBe(true);
    expect(session.exportMessages().some((m) => m.content.includes('<code_execution>'))).toBe(
      true,
    );
  }, 180_000);

  it('tools', async () => {
    const session = new LlmSession({
      model: LIVE_GROQ_TOOLS_MODEL,
      capabilities: { tools: true },
      tools: [LIVE_PICK_NUMBER_TOOL],
      functionCallingMode: 'ANY',
      prompt: 'Call pick_number once then say the number.',
      maxOutputTokens: 256,
    });
    const recorder = new SessionFixtureRecorder('groq-tools-session', session, 'groq');
    const result = await session.send();
    recorder.addStep(result);
    recorder.finish();
    logLiveCallResult('groq / tools', result);
    assertCapabilityTranscript({
      result,
      messages: session.exportMessages(),
      registryPattern: /^llama-3\.1-8b-instant/,
      functionCalls: ['pick_number'],
    });
  }, 90_000);

  it('structuredJson', async () => {
    const callOptions = {
      model: LIVE_GROQ_STRUCTURED_JSON_MODEL,
      capabilities: { structuredJson: true } as const,
      structuredOutput: LIVE_COUNTRY_SCHEMA,
      prompt: 'Return JSON for France.',
      maxOutputTokens: 256,
    };
    const result = await callLlmLive(callOptions);
    recordSingleCallFixture({
      scenarioId: 'groq-structuredJson',
      provider: 'groq',
      callOptions,
      result,
    });
    logLiveCallResult('groq / structuredJson', result);
    const parsed = parseJsonFromModelText(result.text) as { country?: string };
    expect(parsed.country?.toLowerCase()).toMatch(/france/);
  }, 90_000);
});

describe('LLM capability live tests without API keys', () => {
  it.skipIf(hasGeminiLiveKey() && hasGroqLiveKey())(
    'requires GEMINI_API_KEY and/or GROQ_API_KEY for provider-specific suites',
    () => {
      expect(hasGeminiLiveKey() || hasGroqLiveKey()).toBe(false);
    },
  );
});
