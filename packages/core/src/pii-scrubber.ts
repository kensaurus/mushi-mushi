export interface PiiScrubberConfig {
  emails?: boolean;
  phones?: boolean;
  creditCards?: boolean;
  ssns?: boolean;
  ipAddresses?: boolean;
}

interface PiiPattern {
  key: keyof PiiScrubberConfig;
  regex: RegExp;
  replacement: string;
}

// Order matters: SSN → CC → email → phone → IP
// CC must run before phone to prevent phone regex from partially matching CC sequences
const ORDERED_PATTERNS: PiiPattern[] = [
  { key: 'ssns', regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[REDACTED_SSN]' },
  { key: 'creditCards', regex: /\b(?:\d[ -]*){12,18}\d\b/g, replacement: '[REDACTED_CC]' },
  { key: 'emails', regex: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, replacement: '[REDACTED_EMAIL]' },
  { key: 'phones', regex: /(?:\+\d{1,3}[\s.-])?\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,4}\b/g, replacement: '[REDACTED_PHONE]' },
  { key: 'ipAddresses', regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[REDACTED_IP]' },
];

const DEFAULT_CONFIG: PiiScrubberConfig = {
  emails: true,
  phones: true,
  creditCards: true,
  ssns: true,
  ipAddresses: false,
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
