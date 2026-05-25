import { ThinkingLevel, type ThinkingConfig } from '@google/genai';
import type { ThinkingModeKind, ThinkingPower } from '../../shared/gemini-types.js';

export function buildThinkingConfig(
  thinkingMode: ThinkingModeKind,
  thinkingPower: ThinkingPower = 'off',
  includeThoughts?: boolean,
): ThinkingConfig | undefined {
  if (thinkingMode === 'none' || thinkingPower === 'off') {
    return undefined;
  }

  const config: ThinkingConfig = {};

  if (includeThoughts !== false) {
    config.includeThoughts = true;
  }

  if (thinkingMode === 'budget') {
    switch (thinkingPower) {
      case 'low':
        config.thinkingBudget = 1024;
        break;
      case 'medium':
        config.thinkingBudget = -1;
        break;
      case 'high':
        config.thinkingBudget = 8192;
        break;
      default:
        return undefined;
    }
    return config;
  }

  if (thinkingMode === 'levels') {
    switch (thinkingPower) {
      case 'minimal':
        config.thinkingLevel = ThinkingLevel.MINIMAL;
        break;
      case 'low':
        config.thinkingLevel = ThinkingLevel.LOW;
        break;
      case 'medium':
        config.thinkingLevel = ThinkingLevel.MEDIUM;
        break;
      case 'high':
        config.thinkingLevel = ThinkingLevel.HIGH;
        break;
      default:
        return undefined;
    }
    return config;
  }

  return undefined;
}

export function isThinkingApplied(config: ThinkingConfig | undefined): boolean {
  return config !== undefined;
}
