# Scene system

Documentation for the 2.5D landscape scene and the LLM scene agent.

- **[scene-agent.md](./scene-agent.md)** — `LandscapeSceneState`, object catalog, agent tools, `POST /api/scene-agent`, client bridge (`GameShell` / `SceneAgentPanel`)
- **[../src/landscape-display/ARCHITECTURE.md](../src/landscape-display/ARCHITECTURE.md)** — Three.js renderer, cylindrical background, `LandscapeScene` / `LandscapeSceneController` API

Types: [`shared/scene-agent-types.ts`](../shared/scene-agent-types.ts). Catalog: [`shared/scene-catalog.ts`](../shared/scene-catalog.ts). Server entry: [`server/scene/run-scene-agent.ts`](../server/scene/run-scene-agent.ts).

For LLM agent loops and `submit_final_answer`, see [llm-usage.md](./llm-usage.md).
