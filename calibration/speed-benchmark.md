# Speed benchmark

Generated: 2026-05-24T15:14:14.687Z
Prompt: `Reply with exactly: OK`
Runs per probe: 1

| apiModelId | bakedThinking | thinkingMode | p50 ms | p95 ms | ok/total |
|------------|---------------|--------------|--------|--------|----------|
| meta-llama/llama-4-scout-17b-16e-instruct | off | none | 75 | 75 | 1/1 |
| openai/gpt-oss-20b | off | none | 95 | 95 | 1/1 |
| llama-3.3-70b-versatile | off | none | 102 | 102 | 1/1 |
| llama-3.1-8b-instant | off | none | 122 | 122 | 1/1 |
| qwen/qwen3-32b | off | none | 184 | 184 | 1/1 |
| allam-2-7b | off | none | 188 | 188 | 1/1 |
| gemini-3.1-flash-lite | medium | levels | 837 | 837 | 1/1 |
| groq/compound | off | none | 1948 | 1948 | 1/1 |
| groq/compound-mini | off | none | 4874 | 4874 | 1/1 |
| gemini-3.1-flash-lite | minimal | levels | 13313 | 13313 | 1/1 |
| gemini-2.5-flash-lite | off | budget | — | — | 0/1 |
| gemini-2.5-flash-lite | low | budget | — | — | 0/1 |
| gemini-2.5-flash-lite | medium | budget | — | — | 0/1 |
| gemini-2.5-flash-lite | high | budget | — | — | 0/1 |
| gemini-3.1-flash-lite | low | levels | — | — | 0/1 |
| gemini-3.1-flash-lite | high | levels | — | — | 0/1 |
| gemini-2.5-flash | off | budget | — | — | 0/1 |
| gemini-2.5-flash | low | budget | — | — | 0/1 |
| gemini-2.5-flash | medium | budget | — | — | 0/1 |
| gemini-2.5-flash | high | budget | — | — | 0/1 |
| gemini-3.5-flash | minimal | levels | — | — | 0/1 |
| gemini-3.5-flash | low | levels | — | — | 0/1 |
| gemini-3.5-flash | medium | levels | — | — | 0/1 |
| gemini-3.5-flash | high | levels | — | — | 0/1 |
| gemini-2.5-pro | medium | budget | — | — | 0/1 |
| gemini-2.5-pro | high | budget | — | — | 0/1 |
| gemini-3.1-pro-preview | high | levels | — | — | 0/1 |
| openai/gpt-oss-120b | off | none | — | — | 0/1 |

Set `SPEED_TIER_BOUNDS_MS` in `server/gemini/speed-tier-bounds.ts` from these results, then run `npm run assign:speed-tiers`.
