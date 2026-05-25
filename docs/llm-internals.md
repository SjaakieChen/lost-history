# LLM internals

How the server LLM layer works under the hood. For call patterns and parameters, see [llm-usage.md](./llm-usage.md).

---

## Architecture overview

```mermaid
flowchart TB
  subgraph public [Public contract]
    CO[CallLlmOptions]
    CM[ChatMessage transcript]
  end
  subgraph routing [Routing]
    MS[Model registry + speed tiers]
    AV[Availability / quota / ping]
  end
  subgraph thread [ProviderThreadState]
    GT[Gemini contents]
    GR[Groq OpenAI messages]
  end
  subgraph providers [Providers]
    GEM[Gemini generateContent]
    GRQ[Groq chat.completions]
  end
  CO --> MS
  MS --> AV
  CO --> thread
  thread --> GEM
  thread --> GRQ
  CM <-- export/import
```

**Public contract:** callers send `prompt`, `messages`, `systemInstruction`, and `tools`. Provider-specific history (`Content[]` or Groq message params) stays in `ProviderThreadState` inside `callLlm`, `callLlmAgent`, and `LlmSession`.

**Code layout:**

| Path | Role |
|------|------|
| `shared/gemini-types.ts` | Shared types |
| `server/gemini/call-llm.ts` | Single-turn orchestration |
| `server/gemini/call-llm-agent.ts` | Agent loop |
| `server/llm/conversation/*` | Thread state, import/export |
| `server/llm/session.ts` | `LlmSession` |
| `server/gemini/models.ts` | Registry, speed tiers |
| `server/groq/generate.ts` | Groq API adapter |

---

## `ProviderThreadState`

Discriminated union:

- **Gemini:** `{ provider: 'gemini', contents: Content[] }` — native `@google/genai` blocks
- **Groq:** `{ provider: 'groq', messages: ChatCompletionMessageParam[] }` — OpenAI-compatible chat

Created by `createThreadState(resolvedModel, options)` in `server/llm/conversation/bootstrap.ts` from `messages` / `prompt` / `systemInstruction`.

`callLlm` accepts optional server-only `threadState` (`InternalCallLlmOptions`) to continue a thread without re-encoding public messages.

---

## Encoders

| Provider | Encode (request) | Append after response |
|----------|------------------|------------------------|
| Gemini | `encodeGeminiContents(thread)` | `appendGeminiModelResponse`, `appendGeminiToolResponse` |
| Groq | `encodeGroqMessages(thread)` | `appendGroqAssistantMessage`, `appendGroqToolResult` |

`chatMessageToGeminiContent` / `chatMessageToGroqParam` map portable roles:

- `user` / `assistant` → user/model or user/assistant text
- `tool` → Gemini `functionResponse` part or Groq `role: 'tool'` message

Import normalization: `normalizeImportedMessages` in `import.ts` (optional `preserveToolRole` for models with function calling).

---

## Agent loop

```mermaid
sequenceDiagram
  participant A as callLlmAgent
  participant L as callLlm
  participant T as ProviderThreadState
  participant H as toolHandlers
  A->>L: generate (preferred registryKey; failover each step)
  L->>T: encode + provider call
  L-->>A: functionCalls + registryKey
  alt provider changed vs prior thread
    A->>T: rebuild from exportToMessages transcript
  else has tool calls
    A->>H: execute handlers
    H-->>A: JSON results
    A->>T: append tool responses
  else final text or submit_final_answer
    A-->>A: terminate
  end
```

1. Build from options; inject `submit_final_answer` when `termination` allows.
2. Loop up to `maxSteps`: `callLlm` with `threadState`, `model: lockedRegistryKey ?? options.model`, and `threadRebuildMessages` from prior steps.
3. After each success, lock `result.registryKey` (stable registry id, not API id). On **provider change** (Gemini ↔ Groq), re-bootstrap thread via `rebuildThreadForProvider` from portable transcript (text-only; thought signatures are not preserved).
4. Execute `toolHandlers`; unknown tools get `{ error: '...' }`. Handlers should return `{ ok: true }` / `{ ok: false, error }` (or `{ error }`) so the model can retry.
5. `toolSequence` restricts one primary tool per step and can reject premature final tool.
6. `buildAgentSystemInstruction` tells the model to read each tool result before continuing and to call `submit_final_answer` only after verified success.
7. Export `messages` via `exportToMessages(baseMessages, steps, options)` with optional `model` on assistant/tool lines.

Termination: `'final_tool' | 'natural' | 'max_steps'`.

---

## Transcript format (`export` / `import`)

Portable `ChatMessage[]` is the **unified history** for `LlmSession`, `callLlmAgent`, HTTP `messages`, and cross-model chaining. Built by `buildTranscriptTurnFromResult` in `server/llm/conversation/transcript.ts` after each `callLlm` success.

| Field on `ChatMessage` | Content |
|------------------------|---------|
| `content` | Visible answer + embedded specialist tags |
| `thoughts` | Optional internal reasoning (assistant only) |
| `model` | Registry key for that turn |

**Caller tools** (when `includeToolSummary: true`):

```text
Optional visible text

<tool_call name="get_year">
{"event":"fall of Rome"}
</tool_call>
```

**Built-in web search** (from Gemini `groundingMetadata` or Groq `executed_tools[].search_results`):

```text
<web_search>
{"queries":["..."], "sources":[{"title":"...","url":"..."}]}
</web_search>
```

**Built-in code execution** (from Groq `executed_tools`):

```text
<code_execution>
{"code":"...", "output":"...", "type":"python"}
</code_execution>
```

**Tool result:**

```json
{ "role": "tool", "toolName": "get_year", "content": "{\"year\":476}", "model": "gemini-3.5-flash-medium" }
```

`CallLlmResult.executedTools` mirrors parsed provider artifacts before tags are embedded. Groq same-provider threads also keep native `reasoning` and `executed_tools` on assistant messages (`groq-thread.ts`).

`formatToolCallBlock` / `parseToolCallBlocks` in `server/llm/conversation/tool-tags.ts`. Specialist tags in `server/llm/conversation/specialist-tags.ts`.

`exportMessages({ includeToolSummary: false })` strips specialist and `<tool_call>` blocks, keeping visible assistant text only.

---

## Speed tier routing

**Tiers:** `instant` → `fast` → `moderate` → `slow` (fastest to slowest).

When `model` is omitted, `callLlm`:

1. Resolves `speedTier` from options or `getDefaultSpeedTier()` (from `GEMINI_DEFAULT_MODEL` registry entry).
2. Iterates tier batches via `iterateSpeedTierBatches` — strongest free-tier model first (`SPEED_TIER_MODEL_ORDER` in `models.ts`, built by `compareRegistryStrength` in `server/gemini/model-ranking.ts`).
3. **Ping** reachable models in the current tier (`pingAllModels`); skip exhausted entries (`availability.ts`).
4. On recoverable failure: mark quota exhaustion when applicable, try next model, then downgrade tier (`getSpeedTierDowngradeChain`).

### Strength order (product policy)

Failover order is **not** sorted by `calibration/speed-benchmark.json` p50. `buildSpeedTierModelOrder` uses `compareRegistryStrength`:

1. **Gemini** (when present in tier): `gemini-3.5-flash` → `gemini-3.1-flash-lite` → `gemini-3.1-pro`
2. **OpenAI Groq** (`openai--gpt-oss-20b`, then `openai--gpt-oss-120b`)
3. **Compound** (`groq--compound-mini` in `instant`, `groq--compound` in `fast`)
4. Other Groq models in catalog list order

**Tier overrides** (always win over thinking heuristics): `openai--gpt-oss-120b` → `moderate` (ranked above `gemini-3.1-flash-lite-*` in that tier); `groq--compound` → `fast`; `groq--compound-mini` → `instant`.

Gemini 2.5 models are not in the catalog. Default app model: `gemini-3.5-flash-minimal` (or `GEMINI_DEFAULT_MODEL`).

When `model` **is** set (preference, not a hard lock):

1. Try the preferred registry entry once (`modelSelectedBy: 'explicit'`).
2. On recoverable failure: `markExhausted` for quota/rate-limit, then continue tier routing from **that model's `speedTier`** via `iterateSpeedTierBatchesForFailover` (skips the preferred key to avoid double-call). Standalone `speedTier` does not override this anchor when `model` is set.
3. Capability / validation errors still throw immediately (no silent substitute).
4. `modelSelectedBy: 'preferred_failover'` when a tier candidate succeeds after preferred failure.

---

## Failure policy and failover

Implemented in `server/gemini/failure-policy.ts`, `call-llm.ts`, `call-llm-agent.ts`, and `availability.ts`.

| Situation | Behavior |
|-----------|----------|
| Quota / rate limit (429) | `withRateLimitAndRetry` retries **once** on the same model, then marks exhausted and fails over |
| Policy / safety block | Fail over to another model; **`console.warn`** with registry key (not silent) |
| Auth errors (401/403), 5xx, overload | Fail over when another candidate exists |
| `LlmCapabilityError` | Throw immediately (caller must change options) |
| `capabilities.*` set | `resolveCallCapabilities` maps to `require*` filters before tier ordering |
| `capabilities.tools` | `requireFunctionCalling` |
| `capabilities.webSearch` | `requireWebSearch` |
| `capabilities.codeExecution` | `requireCodeExecution` |
| `capabilities.structuredJson` / `strictJson` | `requireStructuredOutput` / `requireStrictJson` |
| Exhaustion cache | **Request-scoped** per `callLlm`, `callLlmAgent`, or `LlmSession` (`ExhaustionContext`) — not shared across unrelated HTTP requests |
| Agent invalid output | Retry once on the same locked model, then unlock and allow `callLlm` tier failover |
| Provider switch | Rebuild `ProviderThreadState` from portable `messages` / `threadRebuildMessages` (includes specialist tags + `thoughts`) |
| All candidates fail | `GeminiQuotaError` with `blockedModels`, `failureKind`, optional `retryAfterMs` |

Per-turn `model` on exported `assistant` / `tool` lines comes from `AgentStep.model` / `CallLlmResult.registryKey`.

`CallLlmResult.registryKey` is the stable lock id for agents and `LlmSession` (API `model` may differ per provider).

Result metadata: `speedTierRequested`, `speedTierUsed`, `speedTierDowngraded`, `modelsAttempted`, `modelSelectedBy`, `registryKey`.

Specialist capability labels (set per catalog row in `shared/gemini-types.ts`):

| Label | Field | Failover filter |
|-------|-------|-----------------|
| tools | `supportsFunctionCalling` | `requireFunctionCalling` |
| web search | `supportsWebSearch` | `requireWebSearch` |
| code execution | `supportsCodeExecution` | `requireCodeExecution` |
| structured JSON | `supportsStructuredOutput` or `supportsStrictJson` | `requireStructuredOutput` |
| strict JSON | `supportsStrictJson` | `requireStrictJson` |

Groq strict JSON uses `response_format: { type: 'json_schema', json_schema: { strict: true, ... } }` only when caller `capabilities.strictJson` is true (see `server/groq/generate.ts`). Catalog `supportsStrictJson` means the model *can* use strict mode, not that every structured call uses it.

### Activation vs catalog

- **Catalog** (`supports*` on `TextModelInfo`) — what the model can do.
- **`capabilities` on the request** — what this call requires for routing (`require*` filters).
- **Activation** (`resolveCallCapabilities().activation`) — what provider params are sent. Groq `strict: true` only when `activation.strictJson` is true.

Gemini `capabilities.webSearch` adds `{ googleSearch: {} }` to generate `tools` in `buildRequestConfig`. Response `groundingMetadata` is parsed in `server/gemini/grounding.ts` into `executedTools` and `<web_search>` tags.

Groq `capabilities.codeExecution` on Compound needs no extra request tools; on GPT-OSS adds `{ type: 'code_interpreter' }` with `tool_choice: 'required'` when no caller tools (`server/groq/generate.ts`). `message.reasoning` and `message.executed_tools` are parsed in `server/groq/groq-message.ts`.

### Provider artifact surfaces

| Provider | Capability | User answer | Structured artifacts |
|----------|------------|-------------|----------------------|
| Gemini | webSearch | `text` parts | `candidates[0].groundingMetadata` |
| Gemini | tools | `text` + `functionCall` parts | Native content parts |
| Groq Compound | webSearch / codeExecution | `message.content` | `message.executed_tools`, `message.reasoning` |
| Groq GPT-OSS | codeExecution | `message.content` | `code_interpreter` tool + `executed_tools` |

---

## Calibration hooks

| Script | Purpose |
|--------|---------|
| `npm run calibrate:speed` | Latency probes → `calibration/speed-benchmark.json` |
| `npm run assign:speed-tiers` | Assign `speedTier` from bounds |
| `npm run calibrate:multiturn` | Multi-turn latency benchmarks |

`server/gemini/speed-tier-bounds.ts` — `SPEED_TIER_BOUNDS_MS`, `areSpeedTierBoundsConfigured()`.

`server/gemini/probe-matrix.ts` — `buildProbeMatrix`, `CALIBRATION_PROMPT` for consistent probes.

`server/gemini/speed-tier-classify.ts` — classify latency into tiers.

---

## Groq vs Gemini

| Aspect | Gemini | Groq |
|--------|--------|------|
| API | `generateContent` + `Content[]` | `chat.completions` |
| Thinking | `buildThinkingConfig` from `bakedThinkingPower` | Groq `message.reasoning` → `CallLlmResult.thoughts` |
| Structured output | JSON schema / OpenAPI schema | `json_schema` (`strict: true` on GPT-OSS) or `json_object` fallback |
| Tools | `functionDeclarations` + `toolConfig` (caller `capabilities.tools`) | OpenAI `tools` + `tool_choice` |
| Web search | `googleSearch` tool when `capabilities.webSearch` | Built-in on Compound models |
| Strict JSON | Schema + JSON mime | `json_schema` with `strict: true` only when `capabilities.strictJson` |
| Thread growth | Native model `content` parts | Assistant message + tool messages |
| Env | `GEMINI_API_KEY` | `GROQ_API_KEY` |

Provider mismatch with an existing `threadState` triggers **thread rebuild** from `threadRebuildMessages` / `messages` when failover changes provider mid-run (agent/session). Portable tags preserve search/code context; native Groq `executed_tools` on thread messages are used when staying on Groq.

---

## Thinking (Gemini only)

`bakedThinkingPower` on each registry entry maps through `thinkingMode`:

| `thinkingMode` | Families | Mapping |
|----------------|----------|---------|
| `none` | Gemini 2.0 | Ignored |
| `budget` | Gemini 2.5 | low/medium/high token budgets |
| `levels` | Gemini 3+ | minimal/low/medium/high levels |

`includeThoughts` controls `result.thoughts` and `usage.thoughtsTokens`.

---

## Errors

- `LlmCapabilityError` — model lacks function calling / structured output / thinking (no failover)
- `GeminiQuotaError` — all candidates exhausted; may include `blockedModels`, `failureKind`, `retryAfterMs`
- `AgentMaxStepsError` — agent exceeded `maxSteps` after retries/failovers (includes partial `steps`)

`resetExhaustionState()` clears the module default exhaustion context in tests only.
