import { describe, it, expect } from 'vitest';
import { scrubPii, createPiiScrubber, scrubUrl } from './pii-scrubber';

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

  it('redacts RealWorld-style "Authorization: Token <jwt>" text', () => {
    // Conduit clients use `Token <jwt>` (not `Bearer`) — the JWT pattern
    // must catch the token regardless of the scheme word in front of it.
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJqYWtlIn0.abc-123_XYZ';
    expect(scrubPii(`Authorization: Token ${jwt}`)).toBe(
      'Authorization: Token [REDACTED_JWT]',
    );
  });
});

describe('scrubUrl', () => {
  const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJqYWtlIn0.abc-123_XYZ';

  it('redacts values of known-sensitive query keys, preserves the rest', () => {
    expect(
      scrubUrl('https://api.example.com/articles?tag=dragons&token=supersecret&limit=10'),
    ).toBe('https://api.example.com/articles?tag=dragons&token=[Scrubbed]&limit=10');
  });

  it('matches sensitive keys by substring (access_token, api-key, user[email])', () => {
    expect(scrubUrl('/cb?access_token=abc&api-key=def&user%5Bemail%5D=x%40y.com')).toBe(
      '/cb?access_token=[Scrubbed]&api-key=[Scrubbed]&user%5Bemail%5D=[Scrubbed]',
    );
  });

  it('redacts OAuth code / key / sig by exact key match', () => {
    expect(scrubUrl('/cb?code=4%2F0AbCd&key=AIza123&sig=deadbeef&coder=ok')).toBe(
      '/cb?code=[Scrubbed]&key=[Scrubbed]&sig=[Scrubbed]&coder=ok',
    );
  });

  it('pattern-scrubs values under innocent key names (JWT, encoded email)', () => {
    const out = scrubUrl(`/next?redirect=${JWT}&to=user%40example.com`);
    expect(out).not.toContain('eyJ');
    expect(out).not.toContain('user%40example.com');
    expect(out).toContain('REDACTED_JWT');
    expect(out).toContain('REDACTED_EMAIL');
  });

  it('scrubs queries inside hash-router fragments', () => {
    expect(scrubUrl('https://x.dev/#/login?token=abc&tag=cats')).toBe(
      'https://x.dev/#/login?token=[Scrubbed]&tag=cats',
    );
  });

  it('leaves paths, keys, and query-less URLs untouched', () => {
    expect(scrubUrl('https://x.dev/api/articles/my-slug')).toBe(
      'https://x.dev/api/articles/my-slug',
    );
    expect(scrubUrl('/a?flag&empty=')).toBe('/a?flag&empty=');
    expect(scrubUrl('')).toBe('');
  });
});
