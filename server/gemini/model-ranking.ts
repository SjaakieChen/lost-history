import type { SpeedTier } from '../../shared/gemini-types.js';
import { listTextModels as listBaseTextModels } from './models-base.js';

const THINKING_SUFFIX_RE = /-(minimal|low|medium|high|off)$/;

const THINKING_SUFFIX_ORDER: Record<string, number> = {
  minimal: 0,
  off: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/** Product tier overrides by catalog base slug (always win over heuristics / p50 bounds). */
const BASE_SPEED_TIER_OVERRIDE: Readonly<Record<string, SpeedTier>> = {
  'openai--gpt-oss-120b': 'moderate',
  'groq--compound': 'fast',
  'groq--compound-mini': 'instant',
};

const GEMINI_BASE_RANK: Readonly<Record<string, number>> = {
  'gemini-3.5-flash': 0,
  'gemini-3.1-flash-lite': 1,
  'gemini-3.1-pro': 2,
};

const GROQ_PRIORITY_BASES = [
  'openai--gpt-oss-20b',
  'openai--gpt-oss-120b',
  'groq--compound-mini',
  'groq--compound',
] as const;

let groqCatalogRankCache: Map<string, number> | null = null;

function getGroqCatalogRank(): Map<string, number> {
  if (groqCatalogRankCache) {
    return groqCatalogRankCache;
  }
  const map = new Map<string, number>();
  let index = GROQ_PRIORITY_BASES.length;
  for (const model of listBaseTextModels()) {
    if (model.provider !== 'groq') {
      continue;
    }
    if (map.has(model.id)) {
      continue;
    }
    map.set(model.id, index);
    index += 1;
  }
  groqCatalogRankCache = map;
  return map;
}

/** Reset cached Groq ranks (tests that mutate catalog). */
export function resetGroqCatalogRankCache(): void {
  groqCatalogRankCache = null;
}

export function resolveBaseSlug(probeKey: string): string {
  return probeKey.replace(THINKING_SUFFIX_RE, '');
}

export function getBaseSpeedTierOverride(baseSlug: string): SpeedTier | undefined {
  return BASE_SPEED_TIER_OVERRIDE[baseSlug];
}

function thinkingSuffixRank(probeKey: string): number {
  const match = probeKey.match(THINKING_SUFFIX_RE);
  if (!match) {
    return 99;
  }
  return THINKING_SUFFIX_ORDER[match[1]] ?? 99;
}

/** Lower = stronger (failover tried first). */
function providerClassRank(baseSlug: string, provider: 'gemini' | 'groq' | undefined): number {
  if (provider === 'gemini' || baseSlug.startsWith('gemini-')) {
    return 0;
  }
  if (baseSlug.startsWith('openai--')) {
    return 1;
  }
  if (baseSlug === 'groq--compound-mini' || baseSlug === 'groq--compound') {
    return 2;
  }
  return 3;
}

function geminiBaseRank(baseSlug: string): number {
  return GEMINI_BASE_RANK[baseSlug] ?? 99;
}

function groqBaseRank(baseSlug: string): number {
  return getGroqCatalogRank().get(baseSlug) ?? 999;
}

/**
 * GPT-OSS 120B in moderate ranks above gemini-3.1-flash-lite but below gemini-3.5-flash.
 */
function moderate120bVsLite(a: string, b: string): number | null {
  const slugA = resolveBaseSlug(a);
  const slugB = resolveBaseSlug(b);
  const is120A = slugA === 'openai--gpt-oss-120b';
  const is120B = slugB === 'openai--gpt-oss-120b';
  const isLiteA = slugA === 'gemini-3.1-flash-lite';
  const isLiteB = slugB === 'gemini-3.1-flash-lite';
  const is35A = slugA === 'gemini-3.5-flash';
  const is35B = slugB === 'gemini-3.5-flash';

  if (is35A && (is120B || isLiteB)) {
    return -1;
  }
  if (is35B && (is120A || isLiteA)) {
    return 1;
  }
  if (is120A && isLiteB) {
    return -1;
  }
  if (is120B && isLiteA) {
    return 1;
  }
  return null;
}

export function compareRegistryStrength(a: string, b: string): number {
  const moderateNudge = moderate120bVsLite(a, b);
  if (moderateNudge !== null) {
    return moderateNudge;
  }

  const slugA = resolveBaseSlug(a);
  const slugB = resolveBaseSlug(b);

  const classA = providerClassRank(slugA, slugA.startsWith('gemini-') ? 'gemini' : 'groq');
  const classB = providerClassRank(slugB, slugB.startsWith('gemini-') ? 'gemini' : 'groq');
  if (classA !== classB) {
    return classA - classB;
  }

  if (classA === 0) {
    const gemA = geminiBaseRank(slugA);
    const gemB = geminiBaseRank(slugB);
    if (gemA !== gemB) {
      return gemA - gemB;
    }
  } else {
    const groqA = groqBaseRank(slugA);
    const groqB = groqBaseRank(slugB);
    if (groqA !== groqB) {
      return groqA - groqB;
    }
  }

  const thinkA = thinkingSuffixRank(a);
  const thinkB = thinkingSuffixRank(b);
  if (thinkA !== thinkB) {
    return thinkA - thinkB;
  }

  return a.localeCompare(b);
}
