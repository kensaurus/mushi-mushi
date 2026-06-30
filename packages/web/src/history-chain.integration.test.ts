import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Mushi } from './mushi';
import type { MushiConfig } from '@mushi-mushi/core';
import { uninstallHistoryPatchForce } from './history-patch';

/** Mirrors glot.it: timeline + discovery + breadcrumbs + rewards all subscribe. */
const GLOT_LIKE_CONFIG: MushiConfig = {
  projectId: '00000000-0000-0000-0000-000000000099',
  apiKey: 'mushi_test_key_abcdefghijklmnop',
  runtimeConfig: false,
  rewards: {
    enabled: true,
    trackActivity: true,
    consentMode: 'explicit',
    flushIntervalMs: 300_000,
  },
  capture: {
    discoverInventory: {
      enabled: true,
      throttleMs: 60_000,
    },
  },
};

function destroyQuietly(): void {
  try {
    Mushi.destroy();
  } catch {
    /* no instance */
  }
}

describe('history chain integration (glot.it stress path)', () => {
  beforeEach(() => {
    destroyQuietly();
    uninstallHistoryPatchForce();
    localStorage.setItem('mushi_rewards_consent_00000000-0000-0000-0000-000000000099', '1');
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
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ data: {} }), { status: 200 }),
    );
  });

  afterEach(() => {
    destroyQuietly();
    uninstallHistoryPatchForce();
    vi.restoreAllMocks();
  });

  it('100× replaceState after full init stack (native-tab simulation) does not overflow', () => {
    const sdk = Mushi.init(GLOT_LIKE_CONFIG);
    sdk.identify('student@test.local');

    expect(() => {
      for (let i = 0; i < 100; i++) {
        history.replaceState({}, '', `/practice/?mode=${i % 5}`);
      }
    }).not.toThrow();
  });

  it('destroy → re-init → 100× pushState survives teardown LIFO', () => {
    const sdk = Mushi.init(GLOT_LIKE_CONFIG);
    sdk.identify('student@test.local');
    Mushi.destroy();

    const sdk2 = Mushi.init(GLOT_LIKE_CONFIG);
    sdk2.identify('student@test.local');

    expect(() => {
      for (let i = 0; i < 100; i++) {
        history.pushState({}, '', `/chat/route-${i}`);
      }
    }).not.toThrow();
  });
});
