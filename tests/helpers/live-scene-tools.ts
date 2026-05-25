import type { LlmFunctionDeclaration, LlmToolHandler } from '../../shared/gemini-types.js';

export const SCENE_OBJECT_NAMES = ['red_candle', 'ancient_scroll', 'silver_inkwell'] as const;

export type SceneObjectName = (typeof SCENE_OBJECT_NAMES)[number];

const SCENE_OBJECTS: Record<
  SceneObjectName,
  { condition: string; material: string; location: string }
> = {
  red_candle: { condition: 'melted', material: 'wax', location: 'on the floor' },
  ancient_scroll: {
    condition: 'torn',
    material: 'parchment',
    location: 'half out of binding',
  },
  silver_inkwell: {
    condition: 'spilled',
    material: 'silver',
    location: 'upside down',
  },
};

export const LIVE_SCENE_SYSTEM_INSTRUCTION = `You are narrating a tabletop scene. Inside the torn book are exactly three objects:
- red_candle
- ancient_scroll
- silver_inkwell

Use get_attribute_object(name_object) to inspect one object's attributes (condition, material, location).
Use edit_object_attribute(name_object, attribute, value) to repair a damaged attribute.
When edit_object_attribute returns status "attribute successfully updated", call submit_final_answer with a short summary of what you fixed.`;

export const LIVE_SCENE_USER_PROMPT =
  'The player rips the book. Choose which object to inspect, read its attributes, repair one damaged attribute, then finish.';

export const getAttributeObjectTool: LlmFunctionDeclaration = {
  name: 'get_attribute_object',
  description: 'Returns attributes for a named object inside the torn book.',
  parameters: {
    type: 'object',
    properties: {
      name_object: {
        type: 'string',
        description: 'Object id: red_candle, ancient_scroll, or silver_inkwell',
      },
    },
    required: ['name_object'],
  },
};

export const editObjectAttributeTool: LlmFunctionDeclaration = {
  name: 'edit_object_attribute',
  description:
    'Sets an attribute on a scene object. Returns status when the update succeeds.',
  parameters: {
    type: 'object',
    properties: {
      name_object: { type: 'string' },
      attribute: {
        type: 'string',
        description: 'One of: condition, material, location',
      },
      value: { type: 'string', description: 'New value for the attribute' },
    },
    required: ['name_object', 'attribute', 'value'],
  },
};

export const liveSceneToolDeclarations = [getAttributeObjectTool, editObjectAttributeTool];

function normalizeObjectName(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function isSceneObjectName(name: string): name is SceneObjectName {
  return (SCENE_OBJECT_NAMES as readonly string[]).includes(name);
}

export const liveSceneToolHandlers: Record<string, LlmToolHandler> = {
  get_attribute_object: async (args) => {
    const name = normalizeObjectName(args.name_object);
    if (!isSceneObjectName(name)) {
      return {
        error: `Unknown object "${args.name_object}". Choose: ${SCENE_OBJECT_NAMES.join(', ')}.`,
      };
    }
    return {
      name,
      attributes: { ...SCENE_OBJECTS[name] },
    };
  },

  edit_object_attribute: async (args) => {
    const name = normalizeObjectName(args.name_object);
    if (!isSceneObjectName(name)) {
      return { error: `Unknown object "${args.name_object}".` };
    }
    const attribute = String(args.attribute ?? '').trim();
    const validAttributes = ['condition', 'material', 'location'] as const;
    if (!validAttributes.includes(attribute as (typeof validAttributes)[number])) {
      return {
        error: `Invalid attribute "${attribute}". Use: ${validAttributes.join(', ')}.`,
      };
    }
    const value = String(args.value ?? '').trim();
    if (!value) {
      return { error: 'value is required.' };
    }
    SCENE_OBJECTS[name][attribute as keyof (typeof SCENE_OBJECTS)[SceneObjectName]] = value;
    return {
      status: 'attribute successfully updated',
      object: name,
      attribute,
      value,
    };
  },
};

export const ATTRIBUTE_UPDATED_STATUS = 'attribute successfully updated';
