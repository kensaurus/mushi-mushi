import { describe, it, expect } from 'vitest';
import { scrubPii, createPiiScrubber } from './pii-scrubber';

describe('scrubPii', () => {
  it('redacts email addresses', () => {
    expect(scrubPii('Contact me at john@example.com please')).toBe(
      'Contact me at [REDACTED_EMAIL] please',
    );
  });

  it('redacts multiple emails', () => {
    expect(scrubPii('From a@b.com to c@d.org')).toBe(
      'From [REDACTED_EMAIL] to [REDACTED_EMAIL]',
    );
  });

  it('redacts SSN patterns', () => {
    expect(scrubPii('SSN: 123-45-6789')).toBe('SSN: [REDACTED_SSN]');
  });

  it('redacts credit card numbers', () => {
    expect(scrubPii('Card: 4111 1111 1111 1111')).toBe('Card: [REDACTED_CC]');
  });

  it('redacts phone numbers with separators', () => {
    expect(scrubPii('Call +1-555-123-4567')).toBe('Call [REDACTED_PHONE]');
  });

  it('returns empty string for empty input', () => {
    expect(scrubPii('')).toBe('');
  });

  it('does not redact IPs by default', () => {
    expect(scrubPii('Server at 192.168.1.1')).toBe('Server at 192.168.1.1');
  });
});

describe('createPiiScrubber', () => {
  it('can enable IP redaction', () => {
    const scrubber = createPiiScrubber({ ipAddresses: true });
    expect(scrubber.scrub('Server at 192.168.1.1')).toBe('Server at [REDACTED_IP]');
  });

  it('can disable email redaction', () => {
    const scrubber = createPiiScrubber({ emails: false });
    expect(scrubber.scrub('john@example.com')).toBe('john@example.com');
  });

  it('scrubObject redacts specific keys', () => {
    const scrubber = createPiiScrubber();
    const obj = { description: 'Bug by john@test.com', title: 'Test' };
    const result = scrubber.scrubObject(obj, ['description']);
    expect(result.description).toBe('Bug by [REDACTED_EMAIL]');
    expect(result.title).toBe('Test');
  });
});
