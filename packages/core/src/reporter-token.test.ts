import { describe, it, expect, beforeEach } from 'vitest';
import { clearReporterTokensForTests, getReporterToken } from './reporter-token';

const PROJECT_A = '11111111-1111-1111-1111-111111111111';
const PROJECT_B = '22222222-2222-2222-2222-222222222222';

describe('getReporterToken', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns a string starting with mushi_', () => {
    const token = getReporterToken(PROJECT_A);
    expect(token).toBeTypeOf('string');
    expect(token.startsWith('mushi_')).toBe(true);
  });

  it('returns the same token on subsequent calls for the same project', () => {
    const first = getReporterToken(PROJECT_A);
    const second = getReporterToken(PROJECT_A);
    expect(first).toBe(second);
  });

  it('persists token in project-scoped localStorage', () => {
    const token = getReporterToken(PROJECT_A);
    expect(localStorage.getItem(`mushi:reporter-token:${PROJECT_A}`)).toBe(token);
  });

  it('isolates tokens per project on the same origin', () => {
    const tokenA = getReporterToken(PROJECT_A);
    const tokenB = getReporterToken(PROJECT_B);
    expect(tokenA).not.toBe(tokenB);
  });

  it('migrates legacy global token into the first requested project', () => {
    localStorage.setItem('mushi_reporter_token', 'mushi_legacy-token');
    const token = getReporterToken(PROJECT_A);
    expect(token).toBe('mushi_legacy-token');
    expect(localStorage.getItem(`mushi:reporter-token:${PROJECT_A}`)).toBe('mushi_legacy-token');
  });

  it('legacy no-arg path still reads the global key', () => {
    localStorage.setItem('mushi_reporter_token', 'mushi_global');
    expect(getReporterToken()).toBe('mushi_global');
  });

  it('clearReporterTokensForTests removes scoped storage', () => {
    getReporterToken(PROJECT_A);
    clearReporterTokensForTests(PROJECT_A);
    expect(localStorage.getItem(`mushi:reporter-token:${PROJECT_A}`)).toBeNull();
  });
});
