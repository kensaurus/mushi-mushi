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

// Order matters: SSN → CC → vendor secrets → email → phone → IP. Secret
// tokens are matched *before* the generic email/phone regex because some JWT
// payloads contain `.` that could be mis-parsed as `xyz.abc.com`.
const ORDERED_PATTERNS: PiiPattern[] = [
  { key: 'ssns', regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[REDACTED_SSN]' },
  { key: 'creditCards', regex: /\b(?:\d[ -]*){12,18}\d\b/g, replacement: '[REDACTED_CC]' },

  // Vendor secret tokens — mirrors packages/server/.../pii-scrubber.ts exactly.
  { key: 'secretTokens', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replacement: '[REDACTED_AWS_KEY]' },
  { key: 'secretTokens', regex: /(?:aws_secret_access_key|secret_access_key)["'\s:=]+[A-Za-z0-9/+=]{40}\b/gi, replacement: 'aws_secret_access_key=[REDACTED_AWS_SECRET]' },
  { key: 'secretTokens', regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g, replacement: '[REDACTED_STRIPE_KEY]' },
  { key: 'secretTokens', regex: /\bpk_(?:live|test)_[A-Za-z0-9]{24,}\b/g, replacement: '[REDACTED_STRIPE_PK]' },
  { key: 'secretTokens', regex: /\bxox[abpor]-[A-Za-z0-9-]{10,}\b/g, replacement: '[REDACTED_SLACK_TOKEN]' },
  { key: 'secretTokens', regex: /\bghp_[A-Za-z0-9]{36}\b/g, replacement: '[REDACTED_GITHUB_PAT]' },
  { key: 'secretTokens', regex: /\bgithub_pat_[A-Za-z0-9_]{80,}\b/g, replacement: '[REDACTED_GITHUB_PAT]' },
  { key: 'secretTokens', regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, replacement: '[REDACTED_OPENAI_KEY]' },
  { key: 'secretTokens', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, replacement: '[REDACTED_ANTHROPIC_KEY]' },
  { key: 'secretTokens', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g, replacement: '[REDACTED_GOOGLE_KEY]' },
  { key: 'secretTokens', regex: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replacement: '[REDACTED_JWT]' },

  { key: 'emails', regex: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, replacement: '[REDACTED_EMAIL]' },
  { key: 'phones', regex: /(?:\+\d{1,3}[\s.-])?\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,4}\b/g, replacement: '[REDACTED_PHONE]' },
  { key: 'ipAddresses', regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[REDACTED_IP]' },
  { key: 'ipv6', regex: /\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{0,4}\b/g, replacement: '[REDACTED_IPV6]' },
];

const DEFAULT_CONFIG: PiiScrubberConfig = {
  emails: true,
  phones: true,
  creditCards: true,
  ssns: true,
  ipAddresses: false,
  // Secret tokens default ON — if they leak into a bug report there's no
  // good reason to ship them to our servers. Cheaper to scrub client-side.
  secretTokens: true,
  ipv6: false,
};

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
