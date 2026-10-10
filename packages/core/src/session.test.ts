import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('getSessionId', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.resetModules();
  });

  it('returns a string starting with ms_', async () => {
    const { getSessionId } = await import('./session');
    const id = getSessionId();
    expect(id).toBeTypeOf('string');
    expect(id.startsWith('ms_')).toBe(true);
  });

  it('returns same id on subsequent calls within same import', async () => {
    const { getSessionId } = await import('./session');
    const first = getSessionId();
    const second = getSessionId();
    expect(first).toBe(second);
  });

  it('persists session id in sessionStorage', async () => {
    const { getSessionId } = await import('./session');
    const id = getSessionId();
    expect(sessionStorage.getItem('mushi_session_id')).toBe(id);
  });

  it('keeps the least-significant digit of the random suffix', async () => {
    // 0xFFFFFFFF is a 7-digit base36 number ("1z141z3"); the suffix must be it
    // reduced mod 36^6, not its first six digits.
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation((arr) => {
      (arr as Uint8Array).fill(0xff);
      return arr;
    });
    try {
      const { getSessionId } = await import('./session');
      const suffix = getSessionId().split('_')[2];
      expect(suffix).toBe((0xffffffff % 36 ** 6).toString(36).padStart(6, '0'));
    } finally {
      spy.mockRestore();
    }
  });
});
