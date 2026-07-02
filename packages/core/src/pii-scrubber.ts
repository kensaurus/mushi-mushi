import piiPatternsData from './pii-patterns.json' with { type: 'json' };

export interface PiiScrubberConfig {
  emails?: boolean;
  phones?: boolean;
  creditCards?: boolean;
  ssns?: boolean;
  ipAddresses?: boolean;
  /**
   * Scrub vendor-shaped secret tokens (AWS access keys, Stripe keys,
   * Slack/GitHub PATs, OpenAI/Anthropic/Google keys, JWTs).
   *
   * Wave S1 / D-15: SDK parity with the server-side scrubber. The server
   * scrubs these on every LLM invocation; the SDK now scrubs them at
   * capture so they never hit the wire in the first place — important for
   * users who `console.log(stripeKey)` during dev and later ship bug
   * reports with the error text attached.
   */
  secretTokens?: boolean;
  /** IPv6 addresses. Defaults off for the same reason IPv4 does. */
  ipv6?: boolean;
}

interface PiiPattern {
  key: keyof PiiScrubberConfig;
  regex: RegExp;
  replacement: string;
}

interface RawPiiPattern {
  id: string;
  configKey: keyof PiiScrubberConfig;
  source: string;
  /** Omitted (falsy) for the vast majority of patterns — case-sensitive by default. */
  caseInsensitive?: boolean;
  replacement: string;
  /** Omitted (truthy) for every pattern except IPv4/IPv6, which default off. */
  defaultOn?: boolean;
}

// Order matters: SSN → CC → vendor secrets → email → phone → IP. Secret
// tokens are matched *before* the generic email/phone regex because some JWT
// payloads contain `.` that could be mis-parsed as `xyz.abc.com`.
//
// The pattern list itself lives in ./pii-patterns.json — the single source of
// truth shared with the Flutter SDK's code-generated copy
// (packages/flutter/lib/src/pii_patterns.g.dart, built by
// scripts/generate-flutter-pii-patterns.mjs) so the two scrubbers can't drift.
const RAW_PATTERNS = piiPatternsData.patterns as RawPiiPattern[];

const ORDERED_PATTERNS: PiiPattern[] = RAW_PATTERNS.map((p) => ({
  key: p.configKey,
  regex: new RegExp(p.source, p.caseInsensitive ? 'gi' : 'g'),
  replacement: p.replacement,
}));

const DEFAULT_CONFIG: PiiScrubberConfig = RAW_PATTERNS.reduce<PiiScrubberConfig>((acc, p) => {
  acc[p.configKey] = p.defaultOn !== false;
  return acc;
}, {});

export function createPiiScrubber(config: PiiScrubberConfig = {}) {
  const merged = { ...DEFAULT_CONFIG, ...config };

  const activePatterns = ORDERED_PATTERNS.filter((p) => merged[p.key]);

  function scrub(text: string): string {
    if (!text) return text;
    let result = text;
    for (const { regex, replacement } of activePatterns) {
      result = result.replace(new RegExp(regex.source, regex.flags), replacement);
    }
    return result;
  }

  function scrubObject<T extends Record<string, unknown>>(obj: T, keys: string[]): T {
    const copy = { ...obj };
    for (const key of keys) {
      if (typeof copy[key] === 'string') {
        (copy as Record<string, unknown>)[key] = scrub(copy[key] as string);
      }
    }
    return copy;
  }

  return { scrub, scrubObject };
}

export function scrubPii(text: string, config?: PiiScrubberConfig): string {
  return createPiiScrubber(config).scrub(text);
}
