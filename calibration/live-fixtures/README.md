# Live LLM fixtures (local)

Recorded snapshots from `npm run test:llm:live:record`. **Not committed** — per-machine, per `package.json` version.

## Commands

```bash
# Record (requires GEMINI_API_KEY and/or GROQ_API_KEY)
npm run test:llm:live:record

# Offline contract check against local recordings (skips if none)
npm run test:llm:fixture-contract

# Strict: fail if no fixtures for current version
LIVE_FIXTURE_STRICT=1 npm run test:llm:fixture-contract
```

`test:llm:live:record` sets recording via `npm_lifecycle_event`; you can also use `RECORD_LIVE_FIXTURES=1`.

## Layout

```text
calibration/live-fixtures/0.1.0/
  manifest.json
  index.md              # auto-generated table
  scenarios/
    gemini-webSearch.json
    groq-codeExecution-gpt-oss-session.json
    ...
```

Each scenario JSON uses **the same shapes as runtime**:

| Section | Type | Meaning |
|---------|------|---------|
| `meta` | recording metadata | scenario id, version, provider, model |
| `session` | `LlmSessionOptions` + `exportOptions` | null for single `callLlm` smokes |
| `steps[]` | per-turn timeline | `contextSent`, `result`, `transcriptTurn`, `sessionAfter` |
| `final` | `history` + `exportMessages` | duplicate of last step for quick inspection |

## Two-turn session example (turn 2)

Turn 1 sends portable `messages` / `prompt`. Turn 2 uses native `threadState`; `callLlm` receives `threadRebuildMessages` (full portable history) but not `prompt`/`messages`:

```json
{
  "turn": 2,
  "contextSent": {
    "threadRebuildMessages": [
      { "role": "user", "content": "What is 98765 multiplied by 4321? ..." },
      {
        "role": "assistant",
        "content": "426763565\n\n<code_execution>{...}</code_execution>",
        "thoughts": "...",
        "model": "groq--openai-gpt-oss-20b"
      }
    ],
    "hasThreadState": true,
    "threadProvider": "groq"
  },
  "result": { "text": "426763565", "registryKey": "...", "messages": [...] },
  "sessionAfter": {
    "exportMessages": [
      { "role": "user", "content": "..." },
      { "role": "assistant", "content": "...", "thoughts": "...", "model": "..." },
      { "role": "user", "content": "Repeat the integer product. Digits only." },
      { "role": "assistant", "content": "426763565", "model": "..." }
    ],
    "history": [ /* SessionTurnRecord[] — same four turns */ ]
  }
}
```

Portable transcript **grows** in `exportMessages`; provider context on turn 2+ is mostly the native thread (`hasThreadState: true`).

## Types

- `ChatMessage` — [`shared/gemini-types.ts`](../../shared/gemini-types.ts)
- `SessionTurnRecord`, `LiveFixtureCallContext` — [`server/llm/session.ts`](../../server/llm/session.ts)
- `CallLlmResult` — [`shared/gemini-types.ts`](../../shared/gemini-types.ts)

Recorder: [`tests/helpers/live-fixture-record.ts`](../../tests/helpers/live-fixture-record.ts)
