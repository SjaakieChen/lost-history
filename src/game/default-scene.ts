import { createDefaultSceneState } from '../../shared/scene-agent-types.js';
import type { LandscapeSceneState } from '../../shared/scene-agent-types.js';

/** Default scene for development until LLM/server provides state. */
export const defaultSceneState: LandscapeSceneState = createDefaultSceneState();
