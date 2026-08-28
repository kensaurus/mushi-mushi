import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildBeaconEnvelope,
  extractTunnelPath,
  isMushiBeaconEnvelope,
  isSameOriginOrRelative,
  markPageUnloading,
  resetPageUnloadingForTests,
  sendOnUnload,
  isPageUnloading,
} from './unload-transport';

describe('beacon envelope', () => {
  it('round-trips the flag', () => {
    const env = buildBeaconEnvelope({
      path: '/api/mushi-tunnel/v1/reports',
      headers: { 'X-Mushi-Api-Key': 'mushi_x' },
      body: { id: 'r1' },
    });
    expect(isMushiBeaconEnvelope(env)).toBe(true);
    expect(isMushiBeaconEnvelope({ mushiBeacon: false })).toBe(false);
  });
});

describe('isSameOriginOrRelative', () => {
  it('treats relative paths as same-origin', () => {
    expect(isSameOriginOrRelative('/api/mushi-tunnel/v1/reports')).toBe(true);
  });

  it('rejects a third-party ingest host', () => {
    expect(
      isSameOriginOrRelative(
        'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api/v1/reports',
        'http://localhost:5174',
      ),
    ).toBe(false);
  });
});

describe('extractTunnelPath', () => {
  it('keeps path + query from an absolute URL', () => {
    expect(extractTunnelPath('https://app.example/api/mushi-tunnel/v1/sdk/config?x=1')).toBe(
      '/api/mushi-tunnel/v1/sdk/config?x=1',
    );
  });
});

describe('sendOnUnload', () => {
  afterEach(() => {
    resetPageUnloadingForTests();
  });

  it('uses fetch keepalive when fetch is available', () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const sendBeacon = vi.fn();
    const ok = sendOnUnload({
      url: '/api/mushi-tunnel/v1/reports',
      headers: { 'X-Mushi-Api-Key': 'mushi_test_key_1234567890' },
      body: JSON.stringify({ id: 'r1' }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sendBeacon,
    });
    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.keepalive).toBe(true);
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('falls back to sendBeacon envelope when fetch throws', () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    const ok = sendOnUnload({
      url: '/api/mushi-tunnel/v1/reports',
      headers: { 'X-Mushi-Project': 'proj' },
      body: JSON.stringify({ id: 'r1' }),
      fetchImpl: () => {
        throw new TypeError('fetch failed');
      },
      sendBeacon,
    });
    expect(ok).toBe(true);
    expect(sendBeacon).toHaveBeenCalledOnce();
    const blob = sendBeacon.mock.calls[0][1] as Blob;
    expect(blob.type).toBe('application/json');
  });

  it('markPageUnloading flips the module flag', () => {
    expect(isPageUnloading()).toBe(false);
    markPageUnloading();
    expect(isPageUnloading()).toBe(true);
  });
});
