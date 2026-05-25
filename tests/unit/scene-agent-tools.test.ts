import { describe, expect, it } from 'vitest';
import { createDefaultSceneState } from '../../shared/scene-agent-types.js';
import { createSceneToolHandlers } from '../../server/scene/scene-agent-tools.js';
import { prepareSceneStateForAgent } from '../../server/scene/scene-agent-tools.js';

describe('scene agent tool handlers', () => {
  it('list_available_objects returns catalog without voxels', async () => {
    const state = prepareSceneStateForAgent(createDefaultSceneState());
    const handlers = createSceneToolHandlers(state);
    const result = await handlers.list_available_objects({});
    expect(result.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ catalogId: 'red_candle' }),
        expect.objectContaining({ catalogId: 'example_prop' }),
      ]),
    );
    const first = (result.objects as { catalogId: string }[])[0];
    expect(first).not.toHaveProperty('voxels');
  });

  it('place_instance rejects unknown catalogId', async () => {
    const state = prepareSceneStateForAgent(createDefaultSceneState());
    const handlers = createSceneToolHandlers(state);
    const result = await handlers.place_instance({
      instanceId: 'x1',
      catalogId: 'nonexistent',
      x: 0,
      depth: 10,
      elevation: 0,
    });
    expect(result.error).toContain('Unknown catalogId');
    expect(state.instances).toHaveLength(0);
  });

  it('place_instance places catalog object', async () => {
    const state = prepareSceneStateForAgent(createDefaultSceneState());
    const handlers = createSceneToolHandlers(state);
    const result = await handlers.place_instance({
      instanceId: 'candle_1',
      catalogId: 'red_candle',
      x: 1,
      depth: 15,
      elevation: 0,
    });
    expect(result.ok).toBe(true);
    expect(state.instances).toHaveLength(1);
    expect(state.instances[0].catalogId).toBe('red_candle');
  });

  it('move_instance and remove_instance work', async () => {
    const state = prepareSceneStateForAgent(createDefaultSceneState());
    const handlers = createSceneToolHandlers(state);
    await handlers.place_instance({
      instanceId: 'scroll_1',
      catalogId: 'ancient_scroll',
      x: 0,
      depth: 12,
      elevation: 0,
    });
    const moved = await handlers.move_instance({
      instanceId: 'scroll_1',
      x: 2,
      depth: 14,
      elevation: 0.1,
    });
    expect(moved.ok).toBe(true);
    expect(state.instances[0].position.x).toBe(2);

    const removed = await handlers.remove_instance({ instanceId: 'scroll_1' });
    expect(removed.ok).toBe(true);
    expect(state.instances).toHaveLength(0);
  });

  it('set_viewer_position and set_head_look update state', async () => {
    const state = prepareSceneStateForAgent(createDefaultSceneState());
    const handlers = createSceneToolHandlers(state);
    await handlers.set_viewer_position({ x: 3 });
    await handlers.set_head_look({ yaw: 40, pitch: 20 });
    expect(state.viewer.positionX).toBeLessThanOrEqual(3);
    expect(state.viewer.headYaw).toBe(30);
    expect(state.viewer.headPitch).toBe(15);
  });
});
