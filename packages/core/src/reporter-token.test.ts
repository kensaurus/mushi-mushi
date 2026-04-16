import { describe, it, expect, beforeEach } from 'vitest';
import { getReporterToken } from './reporter-token';

describe('getReporterToken', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns a string starting with mushi_', () => {
    const token = getReporterToken();
    expect(token).toBeTypeOf('string');
    expect(token.startsWith('mushi_')).toBe(true);
  });

  it('returns the same token on subsequent calls', () => {
    const first = getReporterToken();
    const second = getReporterToken();
    expect(first).toBe(second);
  });

  it('persists token in localStorage', () => {
    const token = getReporterToken();
    expect(localStorage.getItem('mushi_reporter_token')).toBe(token);
  });
});
