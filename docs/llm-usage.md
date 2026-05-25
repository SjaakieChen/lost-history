# LLM usage guide

Practical guide for the Lost History server LLM layer. Import from `server/gemini` (or `./gemini.js` inside `server/`).

**Environment:** `GEMINI_API_KEY` for Gemini models; `GROQ_API_KEY` for Groq. Optional: `GEMINI_DEFAULT_MODEL`, `PORT`.

| API | Use for |
|-----|---------|
| `callLlm(options)` | Single generate turn; tools, structured output, tier routing |
| `callLlmAgent(options)` | Multi-turn tool loop with server-side handlers |
| `LlmSession` | Same model/thread across `send()` and `runAgent()` |
| `generateText(options)` | Text-only wrapper (React `/api/chat` path) |
| `POST /api/llm` | HTTP mirror of `callLlm` |
| `POST /api/chat` | Text-only chat (no tools / JSON schema) |
| `GET /api/models` | Model registry |

Types live in `shared/gemini-types.ts`.

---

## Input formats

### `prompt`

Single user string. **Required** unless `messages` or (server-only) `threadState` is provided.

### `messages`

Array of `ChatMessage`:

| Field | Required | Notes |
|-------|----------|-------|
| `role` | yes | `'user' \| 'assistant' \| 'system' \| 'tool'` |
| `content` | yes | Plain text |
| `toolName` | when `role === 'tool'` | Function name for tool results |
| `toolCallId` | no | Correlation id in exported transcripts |
| `model` | no | Registry key that produced this assistant/tool turn (session/agent export) |

- `system` messages can also be sent via top-level `systemInstruction`.
- Text-only over HTTP: tool rounds are not reconstructed from `messages` alone — use `callLlmAgent` or `LlmSession`.

### `tools`

OpenAPI-style declarations:

```ts
{ name: string; description: string; parameters?: Record<string, unknown> }
```

### `toolHandlers` (agent only)

`Record<string, (args) => Promise<object> | object>` — required for `callLlmAgent`.

### `capabilities`

Specialist features beyond speed tiers. Set a key to `true` only when you need it for **this** call. Omitted keys are not required. Features do **not** turn on from `tools[]` or `structuredOutput` alone.

| Key | What it does | Required payload |
|-----|----------------|------------------|
| `tools` | **Your** function declarations (handlers in `callLlmAgent`) | Non-empty `tools[]` |
| `webSearch` | Provider built-in web search (Gemini Google Search grounding; Groq Compound) | None |
| `codeExecution` | Provider built-in code execution (Groq Compound implicit; GPT-OSS `code_interpreter` tool) | None |
| `structuredJson` | JSON matching a schema (best-effort) | `structuredOutput` with schema |
| `strictJson` | Guaranteed schema match (implies `structuredJson`) | Same `structuredOutput` |

**Structured vs strict:** `structuredJson` means the model should follow your schema; failover may use best-effort mode (`strict: false` on Groq). `strictJson` narrows routing and enables Groq `strict: true` only when you set this flag — failover to GPT-OSS without `strictJson` will **not** send strict mode.

**Rules:**

1. `strictJson: true` requires `structuredJson: true` and `structuredOutput` with a schema.
2. `tools: true` requires non-empty `tools[]`.
3. Do not pass `tools[]` or `structuredOutput` without the matching capability flag (400).
4. Do not use Groq Compound with `capabilities.tools` (no local function calling).
5. `callLlmAgent` always sets `capabilities.tools: true` for your tool loop.

```ts
await callLlm({
  capabilities: { tools: true },
  tools: [{ name: 'lookup', description: '...', parameters: { type: 'object', properties: {} } }],
  prompt: 'Use lookup',
});

await callLlm({
  capabilities: { webSearch: true },
  speedTier: 'moderate',
  prompt: 'Summarize today’s news about Pompeii',
});

await callLlm({
  capabilities: { structuredJson: true, strictJson: true },
  structuredOutput: {
    responseJsonSchema: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
      additionalProperties: false,
    },
  },
  prompt: 'Return JSON',
});
```

Use `GET /api/models` to see `supportsFunctionCalling`, `supportsWebSearch`, `supportsCodeExecution`, `supportsStructuredOutput`, and `supportsStrictJson` per registry row.

### Unified message history

Every `callLlm` result can include:

- `text` — user-facing answer (`message.content` / visible Gemini text).
- `thoughts` — internal reasoning (Gemini thought parts; Groq `message.reasoning`).
- `functionCalls` — **your** tools only.
- `executedTools` — built-in runs (parsed from Gemini `groundingMetadata` or Groq `executed_tools`).
- `messages` — portable `ChatMessage[]` for this turn (user + assistant), with specialist tags embedded in `assistant.content`:

```text
<web_search>{"queries":[...],"sources":[...]}</web_search>
<code_execution>{"code":"...","output":"...","type":"python"}</code_execution>
<tool_call name="pick_number">...</tool_call>
```

`LlmSession` stores the same shape via `exportMessages()`. Use `messages` (or session export) when switching models so search/code context survives provider changes.

**Testing:** Rigorous checks for which field holds what (API vs transcript vs session) live in offline mock tests (`tests/integration/unified-history-*.mock.test.ts`, `tests/helpers/capability-output-expectations.ts`). Live capability tests (`npm run test:llm:live`) are smoke-only — one pass per provider to confirm APIs still respond.

---

## `callLlm`

```ts
import { callLlm } from '../server/gemini.js';

const result = await callLlm({
  speedTier: 'fast',
  prompt: 'Summarize the Peloponnesian War in one sentence.',
  systemInstruction: 'You are a concise historian.',
  maxOutputTokens: 256,
});
```

### Parameters

| Parameter | Required | Default | Notes |
|-----------|----------|---------|-------|
| `prompt` | one of `prompt` / `messages` | — | Single user turn |
| `messages` | one of `prompt` / `messages` | — | Multi-turn text history |
| `model` | no | tier routing | Registry id, API id, or alias — **preference**; recoverable failures fail over starting from this model's `speedTier` |
| `speedTier` | no | from default model | `'instant' \| 'fast' \| 'moderate' \| 'slow'`; used when `model` omitted; does not override preferred model's tier anchor when both are set |
| `systemInstruction` | no | — | Also from `messages` system role |
| `capabilities` | no | all off | Specialist routing + activation (see above) |
| `tools` | no | — | Your tool declarations; requires `capabilities.tools: true` |
| `functionCallingMode` | no | provider default | `'AUTO' \| 'ANY' \| 'NONE' \| 'VALIDATED'` |
| `structuredOutput` | no | — | Requires `capabilities.structuredJson` or `strictJson` |
| `maxOutputTokens` | no | provider default | |
| `includeThoughts` | no | on when thinking active | Include reasoning in `result.thoughts` |

### Result (highlights)

`text`, `model`, `registryKey`, `functionCalls?`, `thoughts?`, `usage?`, `thinkingUsed`, `thinkingPowerApplied`, `finishReason?`, `speedTierRequested`, `speedTierUsed`, `speedTierDowngraded`, `modelsAttempted`, `modelSelectedBy` (`'explicit' | 'tier' | 'preferred_failover'`).

Thinking depth is **baked per registry entry** (`bakedThinkingPower` on each model), not overridable per call.

---

## `callLlmAgent`

```ts
import { callLlmAgent } from '../server/gemini.js';

const result = await callLlmAgent({
  speedTier: 'fast',
  prompt: 'When did Rome fall? Use get_year if needed.',
  tools: [{ name: 'get_year', description: 'Returns a year', parameters: { type: 'object', properties: { event: { type: 'string' } } } }],
  toolHandlers: {
    get_year: async ({ event }) => ({ year: event === 'fall of Rome' ? 476 : null }),
  },
});
```

### Parameters

Inherits all `callLlm` parameters, plus:

| Parameter | Required | Default | Notes |
|-----------|----------|---------|-------|
| `toolHandlers` | **yes** | — | Map of tool name → handler |
| `maxSteps` | no | `10` | Max generate turns; throws `AgentMaxStepsError` |
| `termination` | no | `'both'` | `'both' \| 'natural_only' \| 'final_tool_only'` |
| `finalAnswerTool` | no | `submit_final_answer` | Override final tool name/description |
| `toolSequence` | no | — | Force tool order; reject early `submit_final_answer` |

### Result

Extends `CallLlmResult` with `terminationReason`, `steps`, `stepCount`, and **`messages`** — portable transcript for chaining.

Not exposed over HTTP; call from server code only.

### Agent conventions (verify before finish)

`callLlmAgent` appends standard instructions to your `systemInstruction`:

1. **Wait for tool results** — do not treat a turn as complete until mutation tools have returned; read `ok` / `error` in the tool message on the next step.
2. **Retry on failure** — if a handler returns `ok: false` or `error`, fix arguments or use another tool before finishing.
3. **`submit_final_answer` last** — only after intended mutations succeeded and outcomes were verified (re-list or re-read state when unsure).

The default `submit_final_answer` tool description reinforces this. Scene-specific wording lives in `SCENE_AGENT_SYSTEM_INSTRUCTION` — see [scene-agent.md](./scene-agent.md#agent-run-runsceneagent).

Handlers should return structured success/failure (`{ ok: true }` / `{ ok: false, error: '...' }` or `{ error: '...' }`) so the model can tell whether to retry.

---

## `LlmSession`

```ts
import { LlmSession } from '../server/gemini.js';

const session = new LlmSession({
  model: 'gemini-3.5-flash',
  messages: [{ role: 'user', content: 'Hello' }],
});

const reply = await session.send({ prompt: 'Follow up question' });
const agent = await session.runAgent({ tools, toolHandlers });
const transcript = session.exportMessages({ includeToolSummary: true });
```

### Constructor (`LlmSessionOptions`)

Same fields as `callLlm` (no server-only `threadState`). Seeds history from `messages` and/or `prompt`.

### `send({ prompt? })`

Optional follow-up `prompt`. Returns public `CallLlmResult` (no internal thread state). Locks `registryKey` after each turn; failover on quota updates the lock for subsequent `send()` / `runAgent()` calls.

### `getModelHistory()`

Returns session turns with optional `model` per assistant line (debugging / UI).

### `runAgent(agentOptions)`

Merges session options with agent options; updates internal transcript from `result.messages`.

### `exportMessages({ includeToolSummary? })`

| Option | Default | Effect |
|--------|---------|--------|
| `includeToolSummary` | `true` | Include `<tool_call>` assistant lines and `tool` role messages |

---

## Cross-model chaining

```ts
const gemini = new LlmSession({ model: 'gemini-3.5-flash', prompt: '...' });
await gemini.runAgent({ tools, toolHandlers });

const groq = new LlmSession({
  model: 'openai/gpt-oss-20b',
  messages: gemini.exportMessages({ includeToolSummary: true }),
});
await groq.send({ prompt: 'Summarize the above.' });
```

Or pass `result.messages` from `callLlmAgent` directly into the next `callLlm` / `LlmSession`.

---

## HTTP API

### `POST /api/llm`

Body: `CallLlmOptions` (JSON). **Required:** `prompt` or `messages`.

Returns `CallLlmResult` fields including `registryKey`, `modelsAttempted`, and `modelSelectedBy`. Internal `threadState` is never returned.

**Stateless by default:** the server does not persist chat history between HTTP requests. For long threads, resend `messages[]` from prior responses (including tool transcript lines when using agents) or use `LlmSession` in server code.

Errors:

| Status | When |
|--------|------|
| `400` | Missing input or `LlmCapabilityError` |
| `429` | `GeminiQuotaError` — includes `retryAfterSec` / `retryAfterMs` when known, plus `blockedModels` / `failureKind` when applicable |
| `500` | Unexpected server error |

```bash
curl -s http://localhost:3001/api/llm \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Hello","speedTier":"instant"}'
```

### `POST /api/chat`

Body: `GenerateTextOptions` subset — `prompt` or `messages`; optional `model`, `systemInstruction`, `maxOutputTokens`, `includeThoughts`, `speedTier`.

Does **not** accept: `tools`, `structuredOutput`, `functionCallingMode`.

`generateText()` always resolves an explicit `model` (body or default), so `speedTier` does not change model selection on this path.

### `GET /api/models`

Returns `{ models: TextModelInfo[] }` — ids, `speedTier`, capabilities, `bakedThinkingPower`, `strengthRank`, etc.

### `POST /api/scene-agent`

Scene manipulation agent for the game UI. Uses `callLlmAgent` with a **catalog-only** tool set (predefined `catalogId` values; no custom voxels).

**See [scene-agent.md](./scene-agent.md)** for `LandscapeSceneState`, the full tool table, HTTP body/response, client flow (`GameShell` / `SceneAgentPanel`), and how to extend the catalog.

---


## Failure handling (summary)

- Prefer `callLlm` / `callLlmAgent` / `LlmSession` over raw provider SDKs — quota, policy blocks, and tier failover are handled centrally.
- Set `model` when you want a specific registry entry; recoverable errors still fail over within that model's speed tier (then downgrades).
- Set `capabilities.tools` (and pass `tools[]`) for your function-calling loop; routing enforces `requireFunctionCalling` before tier ordering.
- Set `capabilities.strictJson` when you need guaranteed schema match on Groq OSS; otherwise use `structuredJson` only.
- Check `registryKey` (not API `model` id) when locking or displaying which model served a turn.

See [llm-internals.md](./llm-internals.md#failure-policy-and-failover) for full policy tables.

### Live capability smoke tests

With `GEMINI_API_KEY` and/or `GROQ_API_KEY` in `.env`:

```bash
npm run test:llm:live
```

`tests/live/capabilities.live.test.ts` exercises each `capabilities` flag (Gemini and Groq web search are separate cases). Groq-only tests skip without `GROQ_API_KEY`; Gemini-only tests skip without `GEMINI_API_KEY`.

### Live fixtures (transcript + session timeline)

Record local snapshots in the **exact runtime shapes** (`ChatMessage[]`, `SessionTurnRecord[]`, `CallLlmResult`, per-turn `contextSent`) to inspect what context each turn received:

```bash
npm run test:llm:live:record    # writes calibration/live-fixtures/{version}/
npm run test:llm:fixture-contract
```

See [`calibration/live-fixtures/README.md`](../calibration/live-fixtures/README.md). Fixtures are gitignored; only the README is committed.

---

## What not to do

| Avoid | Why |
|-------|-----|
| Manual tool loops with repeated `callLlm` | Use `callLlmAgent` or `LlmSession` |
| Pass `tools` without `capabilities.tools` | Set `capabilities: { tools: true }` |
| Pass `structuredOutput` without `capabilities.structuredJson` | Set structured capability flags |
| Expect `/api/chat` to run tools or JSON schema | Use `/api/llm` or `callLlm` |
| Assume HTTP remembers chat | No session DB — resend `messages` or use `LlmSession` server-side |
| Parse internal thread state from HTTP | Not exposed; use `messages` / `exportMessages` |
| Use Groq Compound for scene placement | No local function calling — pick an FC-capable Groq/Gemini model |
| Call `submit_final_answer` right after a mutation | Wait for tool result, verify state, retry on failure |
