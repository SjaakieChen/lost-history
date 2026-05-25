# Multi-turn benchmark (3-step tool loop)

Generated: 2026-05-24T15:15:46.329Z
Prompt: `You must complete this task using tools only, one tool per turn, in this exact order: 1) fetch_piece with id "A", 2) combine_pieces with pieces ["A","B"], 3) submit_final_answer with answer "OK". Call exactly one tool per turn. Never call submit_final_answer before the first two tools. Do not reply with plain text.`
Runs per probe: 1

| apiModelId | bakedThinking | total p50 ms | step1 | step2 | step3 | ok/total |
|------------|---------------|--------------|-------|-------|-------|----------|
| openai/gpt-oss-20b | off | 4119 | 251 | 1853 | 2015 | 1/1 |
| llama-3.3-70b-versatile | off | 4145 | 189 | 1999 | 1956 | 1/1 |
| llama-3.1-8b-instant | off | 4174 | 212 | 2063 | 1899 | 1/1 |
| meta-llama/llama-4-scout-17b-16e-instruct | off | 4178 | 153 | 2020 | 2004 | 1/1 |
| openai/gpt-oss-120b | off | 4232 | 267 | 1987 | 1977 | 1/1 |
| qwen/qwen3-32b | off | 4718 | 926 | 1646 | 2145 | 1/1 |
| gemini-3.1-flash-lite | minimal | 5020 | 531 | 774 | 3715 | 1/1 |
| gemini-3.1-flash-lite | low | 11510 | 2768 | 2462 | 6279 | 1/1 |
| gemini-3.1-flash-lite | medium | 12922 | 1710 | 6105 | 5106 | 1/1 |
| gemini-2.5-flash-lite | off | — | — | — | — | 0/1 |
| gemini-2.5-flash-lite | low | — | — | — | — | 0/1 |
| gemini-2.5-flash-lite | medium | — | — | — | — | 0/1 |
| gemini-2.5-flash-lite | high | — | — | — | — | 0/1 |
| gemini-3.1-flash-lite | high | — | — | — | — | 0/1 |
| gemini-2.5-flash | off | — | — | — | — | 0/1 |
| gemini-2.5-flash | low | — | — | — | — | 0/1 |
| gemini-2.5-flash | medium | — | — | — | — | 0/1 |
| gemini-2.5-flash | high | — | — | — | — | 0/1 |
| gemini-3.5-flash | minimal | — | — | — | — | 0/1 |
| gemini-3.5-flash | low | — | — | — | — | 0/1 |
| gemini-3.5-flash | medium | — | — | — | — | 0/1 |
| gemini-3.5-flash | high | — | — | — | — | 0/1 |
