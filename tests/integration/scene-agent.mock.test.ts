import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createDefaultSceneState } from '../../shared/scene-agent-types.js';
import { createApp } from '../../server/app.js';
import * as runSceneAgentModule from '../../server/scene/run-scene-agent.js';

describe('POST /api/scene-agent', () => {
  const app = createApp();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 400 when sceneState is missing', async () => {
    const response = await request(app)
      .post('/api/scene-agent')
      .send({ prompt: 'Place a candle' })
      .expect(400);
    expect(response.body.error).toBe('sceneState is required.');
  });

  it('returns agent result with updated sceneState', async () => {
    const updatedState = createDefaultSceneState();
    updatedState.instances.push({
      instanceId: 'candle_1',
      catalogId: 'red_candle',
      heightMeters: 0.4,
      position: { x: 0, depth: 15, elevation: 0 },
    });

    vi.spyOn(runSceneAgentModule, 'runSceneAgent').mockResolvedValue({
      text: 'Placed a red candle.',
      sceneState: updatedState,
      model: 'gemini-2.5-flash-lite',
      registryKey: 'gemini-2.5-flash-lite-off',
      thinkingUsed: false,
      thinkingPowerApplied: 'off',
      terminationReason: 'final_tool',
      steps: [
        {
          step: 1,
          model: 'gemini-2.5-flash-lite-off',
          toolResults: [{ name: 'place_instance', response: { ok: true } }],
        },
      ],
      stepCount: 1,
    });

    const response = await request(app)
      .post('/api/scene-agent')
      .send({
        prompt: 'Place a red candle at depth 15',
        model: 'gemini-2.5-flash-lite-off',
        sceneState: createDefaultSceneState(),
      })
      .expect(200);

    expect(response.body.text).toContain('candle');
    expect(response.body.sceneState.instances).toHaveLength(1);
    expect(response.body.sceneState.instances[0].catalogId).toBe('red_candle');
  });
});
