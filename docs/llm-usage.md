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
| `tools` | no | — | Enables function calling |
| `functionCallingMode` | no | provider default | `'AUTO' \| 'ANY' \| 'NONE' \| 'VALIDATED'` |
| `structuredOutput` | no | — | `{ responseJsonSchema }` or `{ responseSchema }` |
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

---

## `LlmSession`

```ts
import { LlmSession } from '../server/gemini.js';

const session = new LlmSession({
  model: 'gemini-2.5-flash-lite',
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
const gemini = new LlmSession({ model: 'gemini-2.5-flash-lite', prompt: '...' });
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

Scene manipulation agent for the game UI. Uses `callLlmAgent` with a **catalog-only** tool set (models pick `catalogId` from `list_available_objects`; they cannot submit voxel data).

**Body:**

| Field | Required | Notes |
|-------|----------|-------|
| `sceneState` | yes | `LandscapeSceneState` — background, instances, viewer, sun |
| `prompt` or `messages` | one required | Same as other LLM routes |
| `model` | no | Registry id; must support function calling |
| `speedTier` | no | Default `moderate` if `model` omitted |
| `maxSteps` | no | Default 12 |

**Response:** `CallLlmAgentResult` plus `sceneState` (updated after tool handlers run on the server).

Types: [`shared/scene-agent-types.ts`](../shared/scene-agent-types.ts), catalog: [`shared/scene-catalog.ts`](../shared/scene-catalog.ts).

```bash
curl -s http://localhost:3001/api/scene-agent \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Place a red candle at depth 15m","model":"gemini-2.5-flash-lite-off","sceneState":{"backgroundUrl":"/landscapes/default.svg","instances":[],"viewer":{"positionX":0,"headYaw":0,"headPitch":0},"sun":{"azimuth":180,"elevation":45}}}'
```

---


## Failure handling (summary)

- Prefer `callLlm` / `callLlmAgent` / `LlmSession` over raw provider SDKs — quota, policy blocks, and tier failover are handled centrally.
- Set `model` when you want a specific registry entry; recoverable errors still fail over within that model's speed tier (then downgrades).
- Use `tools` only with models that support function calling; routing enforces this before tier ordering.
- Check `registryKey` (not API `model` id) when locking or displaying which model served a turn.

See [llm-internals.md](./llm-internals.md#failure-policy-and-failover) for full policy tables.

---

## What not to do

| Avoid | Why |
|-------|-----|
| Manual tool loops with repeated `callLlm` | Use `callLlmAgent` or `LlmSession` |
| Expect `/api/chat` to run tools or JSON schema | Use `/api/llm` or `callLlm` |
| Assume HTTP remembers chat | No session DB — resend `messages` or use `LlmSession` server-side |
| Parse internal thread state from HTTP | Not exposed; use `messages` / `exportMessages` |
