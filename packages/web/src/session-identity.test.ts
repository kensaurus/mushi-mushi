/**
 * identifyWithToken() hands the session tracker a SHA-256 of the token's
 * `sub`, never the subject itself (it is the host's user id, often an email),
 * and clears it again on logout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MushiConfig } from '@mushi-mushi/core';

const updateSessionIdentity = vi.hoisted(() => vi.fn());
vi.mock('@mushi-mushi/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mushi-mushi/core')>()),
  updateSessionIdentity,
}));

import { Mushi } from './mushi';

const PID = '00000000-0000-0000-0000-0000000000c1';
const CONFIG: MushiConfig = { projectId: PID, apiKey: 'mushi_test_key_abcdefghijklmnop', runtimeConfig: false };

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
const tokenFor = (sub: string) => `${b64url({ alg: 'HS256' })}.${b64url({ projectId: PID, sub })}.sig`;

async function sha256(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('identifyWithToken → session identity', () => {
  beforeEach(() => {
    try { Mushi.destroy(); } catch { /* none */ }
    updateSessionIdentity.mockClear();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 }));
  });
  afterEach(() => {
    try { Mushi.destroy(); } catch { /* none */ }
    vi.restoreAllMocks();
  });

  it('sends the SHA-256 of the subject, never the subject, and clears it on logout', async () => {
    const sdk = Mushi.init(CONFIG);
    sdk.identifyWithToken(tokenFor('alice@example.com'));

    await vi.waitFor(() => expect(updateSessionIdentity).toHaveBeenCalled());
    expect(updateSessionIdentity).toHaveBeenLastCalledWith(await sha256('alice@example.com'));
    expect(updateSessionIdentity).not.toHaveBeenCalledWith('alice@example.com');

    sdk.identifyWithToken(null);
    expect(updateSessionIdentity).toHaveBeenLastCalledWith(null);
  });

  it('drops a hash that resolves after the user changed', async () => {
    const sdk = Mushi.init(CONFIG);
    sdk.identifyWithToken(tokenFor('first-user'));
    sdk.identifyWithToken(tokenFor('second-user'));

    await vi.waitFor(() => expect(updateSessionIdentity).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/)));
    await new Promise((r) => setTimeout(r, 10));
    const hashes = updateSessionIdentity.mock.calls.map(([h]) => h);
    expect(hashes).toEqual([await sha256('second-user')]);
  });
});
