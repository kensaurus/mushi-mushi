import type { MushiPreFilterConfig } from './types';

export interface PreFilterResult {
  passed: boolean;
  reason?: string;
}

const DEFAULT_MIN_LENGTH = 10;
const DEFAULT_MAX_LENGTH = 2000;

const SPAM_PATTERNS: RegExp[] = [
  /^(.)\1{10,}$/,                          // repeated single character
  /^[A-Z\s!?]{20,}$/,                      // all caps shouting
  /^[\d\s]+$/,                              // numbers only
  /^[^a-zA-Z\u00C0-\u024F\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]{10,}$/, // no real letters
  /\b(test|asdf|qwerty|lorem ipsum)\b/i,    // common test strings
];

const GIBBERISH_PATTERN = /^[bcdfghjklmnpqrstvwxz]{6,}/i; // consonant-only strings

export function createPreFilter(config: MushiPreFilterConfig = {}) {
  const {
    enabled = true,
    blockObviousSpam = true,
    minDescriptionLength = DEFAULT_MIN_LENGTH,
    maxDescriptionLength = DEFAULT_MAX_LENGTH,
  } = config;

  function check(description: string): PreFilterResult {
    if (!enabled) {
      return { passed: true };
    }

    const trimmed = description.trim();

    if (trimmed.length < minDescriptionLength) {
      return { passed: false, reason: `Too short (min ${minDescriptionLength} characters)` };
    }

    if (trimmed.length > maxDescriptionLength) {
      return { passed: false, reason: `Too long (max ${maxDescriptionLength} characters)` };
    }

    if (blockObviousSpam) {
      for (const pattern of SPAM_PATTERNS) {
        if (pattern.test(trimmed)) {
          return { passed: false, reason: 'Detected as spam' };
        }
      }

      if (GIBBERISH_PATTERN.test(trimmed)) {
        return { passed: false, reason: 'Detected as gibberish' };
      }

      const words = trimmed.split(/\s+/).filter((w) => w.length > 1);
      if (words.length < 2) {
        return { passed: false, reason: 'Description needs at least 2 words' };
      }
    }

    return { passed: true };
  }

  function truncate(description: string): string {
    const trimmed = description.trim();
    if (trimmed.length <= maxDescriptionLength) return trimmed;
    return trimmed.slice(0, maxDescriptionLength) + '...';
  }

  return { check, truncate };
}
