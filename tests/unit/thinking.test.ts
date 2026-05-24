import { ThinkingLevel } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { buildThinkingConfig, isThinkingApplied } from '../../server/gemini/thinking.js';

describe('buildThinkingConfig', () => {
  describe('thinkingMode none', () => {
    it('returns undefined for any thinkingPower', () => {
      expect(buildThinkingConfig('none', 'off')).toBeUndefined();
      expect(buildThinkingConfig('none', 'low')).toBeUndefined();
      expect(buildThinkingConfig('none', 'medium')).toBeUndefined();
      expect(buildThinkingConfig('none', 'high')).toBeUndefined();
    });
  });

  describe('thinkingPower off', () => {
    it('returns undefined regardless of thinkingMode', () => {
      expect(buildThinkingConfig('budget', 'off')).toBeUndefined();
      expect(buildThinkingConfig('levels', 'off')).toBeUndefined();
    });
  });

  describe('thinkingMode budget (Gemini 2.5)', () => {
    it('maps low to 1024 token budget', () => {
      expect(buildThinkingConfig('budget', 'low')).toEqual({
        includeThoughts: true,
        thinkingBudget: 1024,
      });
    });

    it('maps medium to dynamic budget (-1)', () => {
      expect(buildThinkingConfig('budget', 'medium')).toEqual({
        includeThoughts: true,
        thinkingBudget: -1,
      });
    });

    it('maps high to 8192 token budget', () => {
      expect(buildThinkingConfig('budget', 'high')).toEqual({
        includeThoughts: true,
        thinkingBudget: 8192,
      });
    });

    it('respects includeThoughts: false', () => {
      expect(buildThinkingConfig('budget', 'low', false)).toEqual({
        thinkingBudget: 1024,
      });
    });
  });

  describe('thinkingMode levels (Gemini 3+)', () => {
    it('maps low to MINIMAL level', () => {
      expect(buildThinkingConfig('levels', 'low')).toEqual({
        includeThoughts: true,
        thinkingLevel: ThinkingLevel.MINIMAL,
      });
    });

    it('maps medium to MEDIUM level', () => {
      expect(buildThinkingConfig('levels', 'medium')).toEqual({
        includeThoughts: true,
        thinkingLevel: ThinkingLevel.MEDIUM,
      });
    });

    it('maps high to HIGH level', () => {
      expect(buildThinkingConfig('levels', 'high')).toEqual({
        includeThoughts: true,
        thinkingLevel: ThinkingLevel.HIGH,
      });
    });
  });
});

describe('isThinkingApplied', () => {
  it('returns false when config is undefined', () => {
    expect(isThinkingApplied(undefined)).toBe(false);
  });

  it('returns true when config is present', () => {
    expect(isThinkingApplied({ thinkingBudget: 1024 })).toBe(true);
    expect(isThinkingApplied({ thinkingLevel: ThinkingLevel.LOW })).toBe(true);
  });
});
