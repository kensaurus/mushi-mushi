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
});
