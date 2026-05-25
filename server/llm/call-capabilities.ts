import type {
  CallLlmOptions,
  LlmCallCapabilities,
  LlmSpecialistCapability,
} from '../../shared/gemini-types.js';
import type { ModelCandidateOptions } from '../gemini/model-selection.js';
import { resolveTextModel, type ResolvedTextModel } from '../gemini/models.js';

export interface CapabilityActivation {
  tools: boolean;
  webSearch: boolean;
  codeExecution: boolean;
  structuredJson: boolean;
  strictJson: boolean;
}

export interface ResolvedCallCapabilities {
  requested: LlmCallCapabilities;
  candidateFilters: ModelCandidateOptions;
  activation: CapabilityActivation;
}

function isCapabilityOn(
  capabilities: LlmCallCapabilities | undefined,
  key: LlmSpecialistCapability,
): boolean {
  return capabilities?.[key] === true;
}

function hasStructuredSchema(options: CallLlmOptions): boolean {
  const schema =
    options.structuredOutput?.responseJsonSchema ?? options.structuredOutput?.responseSchema;
  return schema !== undefined && schema !== null && typeof schema === 'object';
}

function isCompoundRegistryKey(registryKey: string): boolean {
  return registryKey.startsWith('groq--compound');
}

export class CallLlmValidationError extends Error {
  readonly name = 'CallLlmValidationError';

  constructor(message: string) {
    super(message);
  }
}

/** Validates options before routing; throws CallLlmValidationError (map to 400 at HTTP). */
export function validateCallLlmOptions(options: CallLlmOptions): void {
  const caps = options.capabilities ?? {};

  if (isCapabilityOn(caps, 'strictJson') && !isCapabilityOn(caps, 'structuredJson')) {
    throw new CallLlmValidationError(
      'capabilities.strictJson requires capabilities.structuredJson to be true.',
    );
  }

  if (isCapabilityOn(caps, 'tools')) {
    if (!options.tools?.length) {
      throw new CallLlmValidationError('capabilities.tools requires a non-empty tools array.');
    }
  }

  if (options.tools?.length && !isCapabilityOn(caps, 'tools')) {
    throw new CallLlmValidationError(
      'tools were provided but capabilities.tools is not true.',
    );
  }

  const wantsStructured =
    isCapabilityOn(caps, 'structuredJson') || isCapabilityOn(caps, 'strictJson');
  if (wantsStructured) {
    if (!options.structuredOutput) {
      throw new CallLlmValidationError(
        'capabilities.structuredJson or strictJson requires structuredOutput.',
      );
    }
    if (!hasStructuredSchema(options)) {
      throw new CallLlmValidationError(
        'structuredOutput must include responseJsonSchema or responseSchema.',
      );
    }
  }

  if (options.structuredOutput && !wantsStructured) {
    throw new CallLlmValidationError(
      'structuredOutput was provided but neither capabilities.structuredJson nor strictJson is true.',
    );
  }

  if (options.model?.trim() && isCapabilityOn(caps, 'tools')) {
    const resolved = resolveTextModel(options.model.trim());
    if (!resolved.info.supportsFunctionCalling) {
      throw new CallLlmValidationError(
        `Model "${resolved.registryKey}" does not support capabilities.tools (local function calling).`,
      );
    }
    if (isCompoundRegistryKey(resolved.registryKey)) {
      throw new CallLlmValidationError(
        'capabilities.tools cannot be used with Groq Compound models.',
      );
    }
  }
}

export function resolveCallCapabilities(options: CallLlmOptions): ResolvedCallCapabilities {
  const caps = options.capabilities ?? {};
  const tools = isCapabilityOn(caps, 'tools');
  const webSearch = isCapabilityOn(caps, 'webSearch');
  const codeExecution = isCapabilityOn(caps, 'codeExecution');
  const structuredJson =
    isCapabilityOn(caps, 'structuredJson') || isCapabilityOn(caps, 'strictJson');
  const strictJson = isCapabilityOn(caps, 'strictJson');

  return {
    requested: caps,
    candidateFilters: {
      requireFunctionCalling: tools,
      requireWebSearch: webSearch,
      requireCodeExecution: codeExecution,
      requireStructuredOutput: structuredJson,
      requireStrictJson: strictJson,
    },
    activation: {
      tools,
      webSearch,
      codeExecution,
      structuredJson,
      strictJson,
    },
  };
}

export function assertResolvedModelSupportsCapabilities(
  resolved: ResolvedTextModel,
  activation: CapabilityActivation,
): void {
  if (activation.tools && isCompoundRegistryKey(resolved.registryKey)) {
    throw new CallLlmValidationError(
      'capabilities.tools cannot be used with Groq Compound models.',
    );
  }
}
