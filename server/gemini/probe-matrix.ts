import type { CatalogModelDefinition } from '../../shared/gemini-types.js';
import type { LlmProvider, ThinkingModeKind, ThinkingPower } from '../../shared/gemini-types.js';
import { listTextModels } from './models-base.js';

export interface SpeedProbe {
  /** Stable key for benchmark rows and registry ids. */
  probeKey: string;
  baseRegistryId: string;
  apiModelId: string;
  provider: LlmProvider;
  displayName: string;
  thinkingMode: ThinkingModeKind;
  bakedThinkingPower: ThinkingPower;
  supportsThinking: boolean;
  supportsFunctionCalling: boolean;
  supportsWebSearch: boolean;
  supportsCodeExecution: boolean;
  supportsStructuredOutput: boolean;
  supportsStrictJson: boolean;
  freeTierAvailable: boolean;
  rateLimitHints?: { rpm?: number; tpm?: number; rpd?: number };
  aliases?: string[];
}

const LEVELS_PROBES: ThinkingPower[] = ['minimal', 'low', 'medium', 'high'];
const LITE_LEVELS_PROBES: ThinkingPower[] = ['low', 'medium', 'high'];
const BUDGET_FLASH_PROBES: ThinkingPower[] = ['off', 'low', 'medium', 'high'];
const BUDGET_PRO_PROBES: ThinkingPower[] = ['medium', 'high'];
const NONE_PROBES: ThinkingPower[] = ['off'];

function probesForMode(thinkingMode: ThinkingModeKind, isPro: boolean): ThinkingPower[] {
  if (thinkingMode === 'none') {
    return NONE_PROBES;
  }
  if (thinkingMode === 'levels') {
    return isPro ? (['high'] as ThinkingPower[]) : LEVELS_PROBES;
  }
  if (thinkingMode === 'budget') {
    return isPro ? BUDGET_PRO_PROBES : BUDGET_FLASH_PROBES;
  }
  return NONE_PROBES;
}

function probesForBase(base: CatalogModelDefinition): ThinkingPower[] {
  if (base.id === 'gemini-3.1-flash-lite') {
    return LITE_LEVELS_PROBES;
  }
  const provider = base.provider ?? 'gemini';
  if (provider === 'groq') {
    return ['off'];
  }
  return probesForMode(base.thinkingMode, /pro/i.test(base.id));
}

function probeKey(baseId: string, bakedThinkingPower: ThinkingPower): string {
  return `${baseId}-${bakedThinkingPower}`;
}

function thinkingLabel(power: ThinkingPower): string {
  if (power === 'off') {
    return 'no thinking';
  }
  return `${power} thinking`;
}

function probeAliases(
  base: CatalogModelDefinition,
  bakedThinkingPower: ThinkingPower,
  provider: LlmProvider,
): string[] | undefined {
  if (bakedThinkingPower === 'low' && base.id === 'gemini-3.1-flash-lite') {
    return [base.id, base.apiModelId, ...(base.aliases ?? [])];
  }
  if (bakedThinkingPower === 'medium' && base.id !== 'gemini-3.1-flash-lite') {
    return [base.id, base.apiModelId, ...(base.aliases ?? [])];
  }
  if (
    bakedThinkingPower === 'off' &&
    (base.thinkingMode === 'none' || provider === 'groq')
  ) {
    return [base.id, base.apiModelId, ...(base.aliases ?? [])];
  }
  return undefined;
}

/** Full model × thinking matrix for calibration (not speed-tier assigned). */
export function buildProbeMatrix(): SpeedProbe[] {
  const probes: SpeedProbe[] = [];

  for (const base of listTextModels()) {
    const provider = base.provider ?? 'gemini';
    const thinkingPresets = probesForBase(base);

    for (const bakedThinkingPower of thinkingPresets) {
      probes.push({
        probeKey: probeKey(base.id, bakedThinkingPower),
        baseRegistryId: base.id,
        apiModelId: base.apiModelId,
        provider,
        displayName: `${base.displayName} (${thinkingLabel(bakedThinkingPower)})`,
        thinkingMode: base.thinkingMode,
        bakedThinkingPower,
        supportsThinking: base.supportsThinking,
        supportsFunctionCalling: base.supportsFunctionCalling,
        supportsWebSearch: base.supportsWebSearch,
        supportsCodeExecution: base.supportsCodeExecution,
        supportsStructuredOutput: base.supportsStructuredOutput,
        supportsStrictJson: base.supportsStrictJson,
        freeTierAvailable: base.freeTierAvailable,
        rateLimitHints: base.rateLimitHints,
        aliases: probeAliases(base, bakedThinkingPower, provider),
      });
    }
  }

  return probes;
}

export const CALIBRATION_PROMPT = 'Reply with exactly: OK';

export const DEFAULT_CALIBRATION_RUNS = 1;
