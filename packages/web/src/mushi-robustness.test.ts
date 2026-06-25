import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Mushi } from './mushi';
import type { MushiConfig } from '@mushi-mushi/core';

const CONFIG: MushiConfig = {
  projectId: '00000000-0000-0000-0000-000000000001',
  apiKey: 'mushi_test_key_abcdefghijklmnop',
  // Skip the runtime-config network fetch so the SDK is fully self-contained.
  runtimeConfig: false,
};

function destroyQuietly(): void {
  try {
    Mushi.destroy();
  } catch {
    /* no instance */
  }
}

describe('Mushi.init SSR / non-DOM guard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    destroyQuietly();
  });

  it('returns a no-op instance (never throws) when document is undefined', () => {
    destroyQuietly();
    vi.stubGlobal('document', undefined);

    const sdk = Mushi.init(CONFIG);

    expect(sdk).toBeDefined();
    expect(sdk.report).toBeTypeOf('function');
    expect(() => sdk.report()).not.toThrow();
    expect(() => sdk.open()).not.toThrow();
    expect(sdk.isOpen()).toBe(false);
    expect(Array.isArray(sdk.getBreadcrumbs())).toBe(true);
  });
});

describe('Mushi public API error isolation', () => {
  beforeEach(() => {
    destroyQuietly();
    // jsdom doesn't implement matchMedia — the widget render() needs it.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }),
    });
    // Keep the SDK fully offline/self-contained: any network call resolves to
    // an empty envelope so nothing escapes to the real network.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ data: {} }), { status: 200 }),
    );
  });
  afterEach(() => {
    destroyQuietly();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('synchronous public methods never throw into the host', () => {
    const sdk = Mushi.init(CONFIG);

    expect(() => {
      sdk.open();
      sdk.close();
      sdk.show();
      sdk.hide();
      sdk.setMetadata('lessonId', 'abc');
      sdk.setTag('plan', 'pro');
      sdk.setTags({ a: '1', b: '2' });
      sdk.clearTag('plan');
      sdk.addBreadcrumb({ category: 'custom', message: 'hi' });
      sdk.publishPageContext({ route: '/home' });
      sdk.identify('user-1', { email: 'a@b.com' });
      // Re-identifying the same user is a deduped no-op (and must not throw).
      sdk.identify('user-1', { email: 'a@b.com' });
    }).not.toThrow();

    expect(sdk.isOpen()).toBeTypeOf('boolean');
    expect(Array.isArray(sdk.getBreadcrumbs())).toBe(true);
  });

  it('on() returns a callable unsubscribe even if wiring is unusual', () => {
    const sdk = Mushi.init(CONFIG);
    const unsub = sdk.on('report:sent', () => {});
    expect(unsub).toBeTypeOf('function');
    expect(() => unsub()).not.toThrow();
  });

  it('diagnose() resolves to a structurally-valid result (never undefined)', async () => {
    const sdk = Mushi.init(CONFIG);
    const result = await sdk.diagnose();
    // The isolation layer must hand back a real MushiDiagnosticsResult even on
    // the error path — not `undefined`, which a host would choke on.
    expect(result).toBeTypeOf('object');
    expect(result).not.toBeNull();
  });
});
