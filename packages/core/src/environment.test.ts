import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { captureEnvironment } from './environment';

describe('captureEnvironment', () => {
  it('returns a valid MushiEnvironment object', () => {
    const env = captureEnvironment();

    expect(env).toBeDefined();
    expect(env.userAgent).toBeTypeOf('string');
    expect(env.platform).toBeTypeOf('string');
    expect(env.language).toBeTypeOf('string');
    expect(env.viewport).toBeDefined();
    expect(env.viewport.width).toBeTypeOf('number');
    expect(env.viewport.height).toBeTypeOf('number');
    expect(env.timestamp).toBeTypeOf('string');
    expect(env.timezone).toBeTypeOf('string');
  });

  it('captures a valid ISO timestamp', () => {
    const env = captureEnvironment();
    const parsed = new Date(env.timestamp);
    expect(parsed.getTime()).not.toBeNaN();
  });

  it('captures viewport dimensions', () => {
    const env = captureEnvironment();
    expect(env.viewport.width).toBeGreaterThanOrEqual(0);
    expect(env.viewport.height).toBeGreaterThanOrEqual(0);
  });

  describe('SDK boost (2026-05-07)', () => {
    it('captures screen metrics when available', () => {
      const env = captureEnvironment();
      expect(env.screen).toBeDefined();
      // jsdom provides a finite screen.width/height (default 1024x768) and a
      // colorDepth — devicePixelRatio is optional in jsdom and may be
      // undefined or 1 depending on the version.
      expect(env.screen?.width).toBeTypeOf('number');
      expect(env.screen?.height).toBeTypeOf('number');
    });

    it('resolves prefers-color-scheme via matchMedia', () => {
      // jsdom does not implement `window.matchMedia` by default. Stub it so
      // we can prove the helper threads through to the right query, then
      // assert the resolved values.
      const original = window.matchMedia;
      const matched = new Set([
        '(prefers-color-scheme: dark)',
        '(prefers-reduced-motion: reduce)',
      ]);
      window.matchMedia = ((query: string) => ({
        matches: matched.has(query),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as typeof window.matchMedia;
      try {
        const env = captureEnvironment();
        expect(env.prefersColorScheme).toBe('dark');
        expect(env.prefersReducedMotion).toBe(true);
        expect(env.prefersReducedData).toBe(false);
        expect(env.prefersContrast).toBe('no-preference');
        expect(env.forcedColors).toBe(false);
      } finally {
        window.matchMedia = original;
      }
    });

    it('reports navigator.onLine', () => {
      const env = captureEnvironment();
      expect(typeof env.online === 'boolean').toBe(true);
    });

    it('reads buildId from <meta name="mushi:build">', () => {
      const meta = document.createElement('meta');
      meta.name = 'mushi:build';
      meta.content = 'abc123def456';
      document.head.appendChild(meta);
      try {
        const env = captureEnvironment();
        expect(env.buildId).toBe('abc123def456');
      } finally {
        meta.remove();
      }
    });

    it('caps an oversized buildId at 64 chars', () => {
      const meta = document.createElement('meta');
      meta.name = 'mushi:build';
      meta.content = 'x'.repeat(200);
      document.head.appendChild(meta);
      try {
        const env = captureEnvironment();
        expect(env.buildId?.length).toBe(64);
      } finally {
        meta.remove();
      }
    });

    it('captures documentTitle when set', () => {
      const prevTitle = document.title;
      document.title = 'Project · glot.it';
      try {
        const env = captureEnvironment();
        expect(env.documentTitle).toBe('Project · glot.it');
      } finally {
        document.title = prevTitle;
      }
    });

    it('falls back to a media-query display mode', () => {
      const env = captureEnvironment();
      // jsdom answers `false` to every display-mode query, which the helper
      // treats as "no signal" and returns undefined. That's the right
      // behaviour for a test runner — production will get a real value.
      expect(env.displayMode === undefined || typeof env.displayMode === 'string').toBe(true);
    });

    it('exposes pageLoadTiming when performance.getEntriesByType is mocked', () => {
      const original = performance.getEntriesByType.bind(performance);
      const mockNav = {
        startTime: 0,
        domContentLoadedEventEnd: 1234,
        loadEventEnd: 5678,
        responseStart: 200,
        type: 'navigate',
      } as unknown as PerformanceEntry;
      vi.spyOn(performance, 'getEntriesByType').mockImplementation((type: string) => {
        return type === 'navigation' ? [mockNav] : original(type);
      });
      try {
        const env = captureEnvironment();
        expect(env.pageLoadTiming?.domContentLoadedMs).toBe(1234);
        expect(env.pageLoadTiming?.loadCompleteMs).toBe(5678);
        expect(env.pageLoadTiming?.timeToFirstByteMs).toBe(200);
        expect(env.pageLoadTiming?.navigationType).toBe('navigate');
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('reads UA-CH brands when navigator.userAgentData is present', () => {
      const original = (navigator as unknown as { userAgentData?: unknown }).userAgentData;
      Object.defineProperty(navigator, 'userAgentData', {
        configurable: true,
        value: {
          brands: [
            { brand: 'Not_A Brand', version: '99' },
            { brand: 'Chromium', version: '131' },
            { brand: 'Brave', version: '131' },
          ],
          mobile: false,
          platform: 'macOS',
          getHighEntropyValues: () => Promise.resolve({ platformVersion: '14.5.0' }),
        },
      });
      try {
        const env = captureEnvironment();
        expect(env.userAgentData).toBeDefined();
        // Picks the non-Chromium-shell brand so derivative browsers identify
        // as themselves, not as the upstream they wrap.
        expect(env.userAgentData?.browser).toBe('Brave');
        expect(env.userAgentData?.browserVersion).toBe('131');
        expect(env.userAgentData?.os).toBe('macOS');
        expect(env.userAgentData?.mobile).toBe(false);
      } finally {
        if (original === undefined) {
          delete (navigator as unknown as { userAgentData?: unknown }).userAgentData;
        } else {
          Object.defineProperty(navigator, 'userAgentData', { value: original, configurable: true });
        }
      }
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  // `kickOffUserAgentData` caches its first resolution at module scope.
  // Each test that wants a clean slate clears it on its own; we only
  // need the module-level afterEach above for vi.restoreAllMocks().
});

describe('captureEnvironment — native shell detection', () => {
  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    delete (window as unknown as { cordova?: unknown }).cordova;
    delete (globalThis as unknown as { HermesInternal?: unknown }).HermesInternal;
  });

  it('omits `native` in a plain browser context', () => {
    expect(captureEnvironment().native).toBeUndefined();
  });

  it('detects Capacitor via window.Capacitor', () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    expect(captureEnvironment().native).toEqual({ capacitor: true });
  });

  it('detects Cordova via window.cordova', () => {
    (window as unknown as { cordova?: unknown }).cordova = {};
    expect(captureEnvironment().native).toEqual({ cordova: true });
  });

  it('detects React Native via globalThis.HermesInternal', () => {
    (globalThis as unknown as { HermesInternal?: unknown }).HermesInternal = {};
    expect(captureEnvironment().native).toEqual({ reactNative: true });
  });
});
