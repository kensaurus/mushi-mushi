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

// ─────────────────────────────────────────────────────────────────────────────
// URL query-string scrubbing (RealWorld attunement, Phase 1)
//
// Captured network URLs and route-timeline entries keep their query strings
// for debuggability (`?tag=dragons&limit=10` is exactly what you want to see
// on a Conduit article-list bug). But query VALUES are a PII channel:
// `?token=eyJ…`, `?email=jake@x.com`, OAuth `?code=…`. We redact by key name
// for known-sensitive keys, and run the pattern scrubber over the remaining
// values so a JWT hiding under an innocent key (`?next=eyJ…`) is still caught.
// Keys are always preserved — only values are redacted.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Query-param keys whose values are redacted wholesale. Substring match for
 * unambiguous stems (`access_token`, `id_token`, `user[email]` all hit), plus
 * exact matches for short names too ambiguous to substring-match (`key`,
 * `code` — OAuth authorization codes — and `sig`).
 */
const SENSITIVE_QUERY_KEY_SUBSTRING_RE =
  /token|jwt|passw|pwd|secret|api[-_]?key|apikey|auth|session|signature|email|phone|ssn/i;
const SENSITIVE_QUERY_KEY_EXACT_RE = /^(?:key|code|sig)$/i;

function isSensitiveQueryKey(key: string): boolean {
  let decoded = key;
  try {
    decoded = decodeURIComponent(key);
  } catch {
    /* keep raw */
  }
  return (
    SENSITIVE_QUERY_KEY_SUBSTRING_RE.test(decoded) ||
    SENSITIVE_QUERY_KEY_EXACT_RE.test(decoded)
  );
}

function scrubQueryPairs(query: string, scrub: (s: string) => string): string {
  return query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq === -1) return pair;
      const key = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value.length === 0) return pair;
      if (isSensitiveQueryKey(key)) return `${key}=[Scrubbed]`;
      // Generic value scrub. Decode first so percent-encoded PII
      // (`user%40x.com`) matches the same patterns as free text.
      let decoded = value;
      try {
        decoded = decodeURIComponent(value);
      } catch {
        /* malformed escape — scrub the raw value instead */
      }
      const scrubbed = scrub(decoded);
      if (scrubbed !== decoded) return `${key}=${encodeURIComponent(scrubbed)}`;
      return pair;
    })
    .join('&');
}

/**
 * Scrub the query-string portion(s) of a URL — both the standard `?…` part
 * and any `?…` inside the hash fragment (hash routers like RealWorld's
 * `#/path?query` carry their query inside the fragment). Path segments and
 * param keys are left untouched; only values are redacted. Accepts absolute
 * or relative URLs and never throws.
 */
export function scrubUrl(url: string, config?: PiiScrubberConfig): string {
  if (!url || (!url.includes('?') && !url.includes('#'))) return url;
  const { scrub } = createPiiScrubber(config);
  const scrubPart = (part: string): string => {
    const qIdx = part.indexOf('?');
    if (qIdx === -1) return part;
    return part.slice(0, qIdx + 1) + scrubQueryPairs(part.slice(qIdx + 1), scrub);
  };
  const hashIdx = url.indexOf('#');
  if (hashIdx === -1) return scrubPart(url);
  return scrubPart(url.slice(0, hashIdx)) + scrubPart(url.slice(hashIdx));
}
