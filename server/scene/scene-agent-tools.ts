import type { LlmFunctionDeclaration, LlmToolHandler } from '../../shared/gemini-types.js';
import type { LandscapeSceneState } from '../../shared/scene-agent-types.js';
import {
  clearInstances,
  cloneSceneState,
  estimatePlacementLimit,
  getSceneConstantsForTools,
  moveInstance,
  normalizeSceneState,
  placeInstance,
  removeInstance,
  setBackground,
  setHeadLook,
  setSunPosition,
  setViewerPosition,
} from './scene-state.js';
import { listCatalogEntries } from '../../shared/scene-catalog.js';

export const SCENE_AGENT_SYSTEM_INSTRUCTION = `You manipulate a 2.5D landscape scene using tools only.

Rules:
- Never invent voxel data or new object types.
- Only place objects using catalogId values returned by list_available_objects.
- Each placed object needs a unique instanceId (e.g. candle_1).
- Use get_placement_limit(depth) before placing far from center.

Tool workflow (required):
- After place_instance, move_instance, remove_instance, or other mutations, read the tool result on the next turn.
- If the tool returns ok: false or error, fix the issue and retry — do not call submit_final_answer yet.
- Before finishing, verify the scene matches the user's request (e.g. list_placed_instances after placements/moves).
- Call submit_final_answer only after all intended changes succeeded and you have confirmed them.`;

export const SCENE_AGENT_TOOL_DECLARATIONS: LlmFunctionDeclaration[] = [
  {
    name: 'list_available_objects',
    description: 'List predefined catalog objects that can be placed (catalogId, name, description, default height).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_placed_instances',
    description: 'List object instances currently in the scene.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_scene_info',
    description: 'Scene background, instance count, and frozen viewer constants.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_placement_limit',
    description: 'Estimated max lateral placement range (meters) at a given depth.',
    parameters: {
      type: 'object',
      properties: {
        depth: { type: 'number', description: 'Depth into scene in meters (positive)' },
        buffer: { type: 'number', description: 'Optional buffer meters (default 2)' },
      },
      required: ['depth'],
    },
  },
  {
    name: 'place_instance',
    description: 'Place a catalog object instance in the scene.',
    parameters: {
      type: 'object',
      properties: {
        instanceId: { type: 'string' },
        catalogId: { type: 'string' },
        x: { type: 'number', description: 'Lateral offset meters' },
        depth: { type: 'number', description: 'Distance into scene meters' },
        elevation: { type: 'number', description: 'Vertical elevation meters' },
        heightMeters: { type: 'number', description: 'Optional override; default from catalog' },
      },
      required: ['instanceId', 'catalogId', 'x', 'depth', 'elevation'],
    },
  },
  {
    name: 'move_instance',
    description: 'Move an existing instance to a new position.',
    parameters: {
      type: 'object',
      properties: {
        instanceId: { type: 'string' },
        x: { type: 'number' },
        depth: { type: 'number' },
        elevation: { type: 'number' },
      },
      required: ['instanceId', 'x', 'depth', 'elevation'],
    },
  },
  {
    name: 'remove_instance',
    description: 'Remove one instance by instanceId.',
    parameters: {
      type: 'object',
      properties: { instanceId: { type: 'string' } },
      required: ['instanceId'],
    },
  },
  {
    name: 'clear_instances',
    description: 'Remove all placed instances from the scene.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'set_background',
    description: 'Set panoramic background URL (same-origin, e.g. /landscapes/default.svg).',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
  {
    name: 'set_viewer_position',
    description: 'Move viewer left/right in meters (clamped to walk range).',
    parameters: {
      type: 'object',
      properties: { x: { type: 'number' } },
      required: ['x'],
    },
  },
  {
    name: 'set_head_look',
    description: 'Set head yaw (degrees, +/-30) and pitch (0-15 up).',
    parameters: {
      type: 'object',
      properties: {
        yaw: { type: 'number' },
        pitch: { type: 'number' },
      },
      required: ['yaw', 'pitch'],
    },
  },
  {
    name: 'set_sun_position',
    description: 'Set sun azimuth (0-360) and elevation (0-90) for shadows.',
    parameters: {
      type: 'object',
      properties: {
        azimuth: { type: 'number' },
        elevation: { type: 'number' },
      },
      required: ['azimuth', 'elevation'],
    },
  },
];

export function createSceneToolHandlers(
  state: LandscapeSceneState,
): Record<string, LlmToolHandler> {
  return {
    list_available_objects: async () => ({
      objects: listCatalogEntries().map((entry) => ({
        catalogId: entry.catalogId,
        displayName: entry.displayName,
        description: entry.description,
        defaultHeightMeters: entry.defaultHeightMeters,
      })),
    }),

    list_placed_instances: async () => ({
      instances: state.instances.map((i) => ({
        instanceId: i.instanceId,
        catalogId: i.catalogId,
        position: i.position,
        heightMeters: i.heightMeters,
      })),
    }),

    get_scene_info: async () => {
      const constants = getSceneConstantsForTools();
      return {
        backgroundUrl: state.backgroundUrl,
        horizonRatio: state.horizonRatio ?? null,
        instanceCount: state.instances.length,
        viewer: state.viewer,
        sun: state.sun,
        constants,
        note: 'humanHeight and cylinder distances are frozen and cannot be changed via tools.',
      };
    },

    get_placement_limit: async (args) => {
      const depth = Number(args.depth);
      const buffer = args.buffer !== undefined ? Number(args.buffer) : 2;
      if (!Number.isFinite(depth) || depth <= 0) {
        return { error: 'depth must be a positive number.' };
      }
      return {
        depth,
        estimatedMaxLateralMeters: estimatePlacementLimit(depth, buffer),
        note: 'Estimate based on default 21:9 background; actual limit may vary after background load.',
      };
    },

    place_instance: async (args) => {
      const result = placeInstance(state, {
        instanceId: String(args.instanceId ?? ''),
        catalogId: String(args.catalogId ?? ''),
        position: {
          x: Number(args.x),
          depth: Number(args.depth),
          elevation: Number(args.elevation),
        },
        heightMeters:
          args.heightMeters !== undefined ? Number(args.heightMeters) : undefined,
      });
      if (!result.ok) {
        return { error: result.error };
      }
      const placed = state.instances.find((i) => i.instanceId === String(args.instanceId));
      return { ok: true, instance: placed };
    },

    move_instance: async (args) => {
      const result = moveInstance(state, String(args.instanceId ?? ''), {
        x: Number(args.x),
        depth: Number(args.depth),
        elevation: Number(args.elevation),
      });
      if (!result.ok) {
        return { error: result.error };
      }
      return { ok: true };
    },

    remove_instance: async (args) => {
      const result = removeInstance(state, String(args.instanceId ?? ''));
      if (!result.ok) {
        return { error: result.error };
      }
      return { ok: true };
    },

    clear_instances: async () => {
      clearInstances(state);
      return { ok: true, instanceCount: 0 };
    },

    set_background: async (args) => {
      const result = setBackground(state, String(args.url ?? ''));
      if (!result.ok) {
        return { error: result.error };
      }
      return { ok: true, backgroundUrl: state.backgroundUrl };
    },

    set_viewer_position: async (args) => {
      const { clampedX } = setViewerPosition(state, Number(args.x));
      return { ok: true, positionX: clampedX };
    },

    set_head_look: async (args) => {
      const { yaw, pitch } = setHeadLook(state, Number(args.yaw), Number(args.pitch));
      return { ok: true, headYaw: yaw, headPitch: pitch };
    },

    set_sun_position: async (args) => {
      setSunPosition(state, Number(args.azimuth), Number(args.elevation));
      return { ok: true, sun: state.sun };
    },
  };
}

export function prepareSceneStateForAgent(input: LandscapeSceneState): LandscapeSceneState {
  return cloneSceneState(normalizeSceneState(input));
}
