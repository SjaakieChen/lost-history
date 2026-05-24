# LLM layer

Server-side Gemini wrapper. Import from `server/gemini` (or `./gemini.js` inside `server/`).

**Requires:** `GEMINI_API_KEY` in `.env`. Optional: `GEMINI_DEFAULT_MODEL` (defaults to `gemini-3.1-flash-lite`).

---

## Quick reference

| Surface | Use for |
|---------|---------|
| `callLlm(options)` | Full API: tier routing, tools, structured output, `contents` |
| `callLlmAgent(options)` | Multi-turn tool loop with auto execution; returns final answer |
| `generateText(options)` | Legacy text-only wrapper (always picks an explicit model) |
| `POST /api/llm` | HTTP mirror of `callLlm` |
| `POST /api/chat` | Simple chat UI path; text only, no tools/schema |
| `GET /api/models` | Registry with capabilities and tiers |

Types live in `shared/gemini-types.ts` (`CallLlmOptions`, `CallLlmResult`, etc.).

---

## Server: `callLlm()`

```ts
import { callLlm } from '../server/gemini.js';

const result = await callLlm({
  thinkingPowerTier: 'low',          // model routing (when `model` omitted)
  prompt: 'Summarize the Peloponnesian War in one sentence.',
  thinkingPower: 'off',              // default: 'off'
  systemInstruction: 'You are a concise historian.',
  temperature: 0.7,
  maxOutputTokens: 256,
});

console.log(result.text, result.model, result.usage);
```

**Input (one required):**

- `prompt` — single user string
- `messages` — `{ role: 'user' | 'assistant' | 'system', content: string }[]` (simple multi-turn; `system` → `systemInstruction`)
- `contents` — `LlmContentBlock[]` (full Gemini history; required for tool loops and thought signatures)

---

## Model selection

### Tier routing (`thinkingPowerTier`)

When **`model` is omitted**, pick the strongest free-tier model for the tier, with automatic failover:

- Tiers: `'low' | 'medium' | 'high'`
- Order within tier: see `TIER_MODEL_STRENGTH_ORDER` in `server/gemini/models.ts` (e.g. low → `gemini-3.1-flash-lite` first)
- On quota/rate-limit errors: try next model in tier, then **downgrade** tier (`high` → `medium` → `low`)
- Skips models marked exhausted or unreachable (ping check)

Default tier comes from `GEMINI_DEFAULT_MODEL` when `thinkingPowerTier` is omitted.

```ts
const result = await callLlm({
  thinkingPowerTier: 'medium',
  prompt: 'Explain briefly.',
});
// result.modelSelectedBy === 'tier'
// result.thinkingPowerTierRequested / thinkingPowerTierUsed / tierDowngraded
// result.modelsAttempted — models tried this request
```

### Explicit `model`

Registry id, API id, or alias (e.g. `gemini-2.5-flash-lite`).

```ts
await callLlm({ model: 'gemini-2.5-flash-lite', prompt: 'Hi' });
// result.modelSelectedBy === 'explicit'
```

**No failover** when `model` is set — quota or capability errors throw immediately.

Tools or `structuredOutput` filter tier candidates to capable models only.

---

## Conversation / memory

**There is no server-side session or memory store.** The caller keeps history and sends it on each request.

### Simple multi-turn (`messages`)

```ts
const result = await callLlm({
  messages: [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'What year did Rome fall?' },
    { role: 'assistant', content: '476 CE is the common date for the Western Empire.' },
    { role: 'user', content: 'Who was the last emperor?' },
  ],
});
```

### Advanced multi-turn (`contents`)

For function calling (and preserving thought signatures), append **`result.modelContent`** verbatim, then your next user/tool block:

```ts
import { callLlm, buildFunctionResponseContent } from '../server/gemini.js';

const first = await callLlm({
  thinkingPowerTier: 'low',
  prompt: 'Call get_year for "fall of Rome".',
  tools: [{ name: 'get_year', description: 'Returns a year', parameters: { type: 'object', properties: { event: { type: 'string' } } } }],
});

if (first.functionCalls?.length) {
  const call = first.functionCalls[0];
  const second = await callLlm({
    contents: [
      { role: 'user', parts: [{ text: 'Call get_year for "fall of Rome".' }] },
      first.modelContent!,
      buildFunctionResponseContent(call.name, { year: 476 }, call.id),
    ],
    tools: [{ name: 'get_year', description: 'Returns a year' }],
  });
}
```

---

## Function calling

```ts
const result = await callLlm({
  prompt: 'What is the weather in Paris?',
  tools: [
    {
      name: 'get_weather',
      description: 'Get weather for a city',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
    },
  ],
  functionCallingMode: 'AUTO', // 'AUTO' | 'ANY' | 'NONE' | 'VALIDATED'
});

if (result.functionCalls) {
  for (const fc of result.functionCalls) {
    // fc.name, fc.args, fc.id
  }
}
```

- Response: `functionCalls?: { id?, name, args? }[]` and `modelContent` for the next turn
- Helper: `buildFunctionResponseContent(name, response, id?)` → `LlmContentBlock`
- Use **`contents`**, not `messages`, for manual tool round-trips

---

## Agent loop (`callLlmAgent`)

Server-side only — runs a multi-turn **think → tool → think** loop and returns a final answer. Pass TypeScript **tool handlers**; the loop executes tools automatically and continues until the model stops.

```ts
import { callLlmAgent } from '../server/gemini.js';

const result = await callLlmAgent({
  thinkingPowerTier: 'low',
  prompt: 'When did Rome fall? Use get_year if needed.',
  tools: [
    {
      name: 'get_year',
      description: 'Returns a year for a historical event',
      parameters: {
        type: 'object',
        properties: { event: { type: 'string' } },
        required: ['event'],
      },
    },
  ],
  toolHandlers: {
    get_year: async ({ event }) => ({ year: event === 'fall of Rome' ? 476 : null }),
  },
  thinkingPower: 'low',
  maxSteps: 10, // default
});

console.log(result.text);                    // final answer
console.log(result.terminationReason);       // 'final_tool' | 'natural' | 'max_steps'
console.log(result.steps);                   // per-turn trace
```

### Termination (function-call preferred)

Two ways to finish — **`submit_final_answer` is preferred**:

| Path | How | `terminationReason` |
|------|-----|---------------------|
| **Preferred** | Model calls auto-injected `submit_final_answer({ answer })` | `'final_tool'` |
| **Fallback** | Model replies with plain text and no tool calls | `'natural'` |

The system instruction tells the model to call `submit_final_answer` when done. Plain text without a tool call still ends the loop as a fallback.

Options:

- `termination: 'both'` (default) — final tool preferred, plain text accepted
- `termination: 'final_tool_only'` — only `submit_final_answer` ends the loop
- `termination: 'natural_only'` — no `submit_final_answer` injected; text-only stop

Override the tool name via `finalAnswerTool: { name: 'my_final_tool' }`.

### Behavior notes

- **Model pinning** — first turn uses tier routing; subsequent turns reuse the same model (preserves thought signatures)
- **Unknown tools** — missing handlers return `{ error: '...' }` in the function response so the model can recover
- **Parallel FC** — multiple function calls in one turn are all executed
- **`maxSteps` exceeded** → throws `AgentMaxStepsError` with partial `steps` trace
- **HTTP** — not exposed on `/api/llm`; call `callLlmAgent` from server code

For manual single-turn control, use `callLlm()` + `buildFunctionResponseContent` (see above).

### Live smoke test

With `GEMINI_API_KEY` set:

```bash
npm run test:llm:live
```

`tests/live/call-llm-agent.live.test.ts` runs `callLlmAgent` against real Gemini with an `echo` tool (multiple generate turns). Free-tier daily limits apply — retry later if you hit 429.

---

## Structured output (JSON)

Gemini 3+ models only (`supportsStructuredOutput: true`). Tier routing auto-filters when `structuredOutput` is set.

```ts
const result = await callLlm({
  thinkingPowerTier: 'low',
  prompt: 'List two Roman emperors.',
  structuredOutput: {
    responseJsonSchema: {
      type: 'object',
      properties: {
        emperors: { type: 'array', items: { type: 'string' } },
      },
      required: ['emperors'],
    },
    // or: responseSchema: { ... }  // OpenAPI subset
  },
});

const data = JSON.parse(result.text);
```

Unsupported model → `LlmCapabilityError` (HTTP 400 on `/api/llm`).

---

## Thinking

`thinkingPower`: `'off' | 'low' | 'medium' | 'high'` (default **`off`**).

Mapped per model family:

| `thinkingMode` | Models | Mapping |
|----------------|--------|---------|
| `none` | Gemini 2.0 | Thinking ignored |
| `budget` | Gemini 2.5 | low=1024, medium=-1, high=8192 tokens |
| `levels` | Gemini 3+ | low/minimal, medium, high |

- `includeThoughts` — include internal reasoning in `result.thoughts` (default: on when thinking is active)
- Result fields: `thinkingUsed`, `thinkingPowerApplied`, `usage.thoughtsTokens`

```ts
await callLlm({
  model: 'gemini-2.5-flash-lite',
  prompt: 'Solve step by step: 17 × 23',
  thinkingPower: 'medium',
});
```

---

## HTTP API

### `POST /api/llm`

Body: full `CallLlmOptions`. Returns `CallLlmResult`.

```bash
curl -s http://localhost:3001/api/llm \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Hello","thinkingPowerTier":"low"}'
```

Errors: `400` (validation / `LlmCapabilityError`), `429` (`GeminiQuotaError`), `500`.

### `POST /api/chat`

Legacy text endpoint used by the React app. Body: `GenerateTextOptions` (`prompt` or `messages`; optional `thinking`, `thinkingBudget`, `thinkingPower`, etc.).

**Does not accept:** `tools`, `structuredOutput`, `contents`, `functionCallingMode`.

Note: `generateText()` always resolves an explicit `model` (request body or default), so **`thinkingPowerTier` does not change model selection** on this path.

### `GET /api/models`

Returns `{ models: TextModelInfo[] }` — ids, tiers, `supportsFunctionCalling`, `supportsStructuredOutput`, `thinkingMode`, `strengthRank`, etc.

---

## What not to do

| Don't | Why |
|-------|-----|
| Rely on explicit `model` for resilience | No tier/model failover; first quota error fails the request |
| Use `messages` for manual tool loops | Use `callLlmAgent` or `contents` + `modelContent` |
| Expect `/api/chat` to run tools or JSON schema | Use `/api/llm` or `callLlm` directly |
| Assume server remembers chat | No session DB/cache — client must resend history |
| Use `structuredOutput` on 2.0 / 2.5 Flash | Capability check fails unless model supports it |

---

## Gaps / not implemented

- **No persistent conversation memory** — no session ids, Redis, or DB; multi-turn is caller-managed via `messages` or `contents`.
- **No HTTP agent endpoint** — `callLlmAgent` is server-side TypeScript only; `/api/llm` remains single-turn.
- **`/api/chat` is not a full LLM API** — use `/api/llm` or `callLlmAgent` for production features.
