import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enqueue, flush, initRewards, teardown, type RewardsContext } from './rewards';

describe('rewards flush — 4xx backoff', () => {
  const ctx: RewardsContext = {
    client: {
      submitActivity: vi.fn(),
      getMyTier: vi.fn(),
    } as unknown as RewardsContext['client'],
    config: {
      enabled: true,
      trackActivity: true,
      // explicit + pre-granted consent avoids the auto-init submitActivity ping
      consentMode: 'explicit',
      flushIntervalMs: 30_000,
    },
    projectId: 'proj_test',
    userId: 'user_test',
  };

  beforeEach(() => {
    teardown();
    vi.clearAllMocks();
    localStorage.setItem('mushi_rewards_consent_proj_test', '1');
    initRewards(ctx);
    enqueue({ action: 'screen_view', metadata: { route: '/home' } });
  });

  it('drops the batch and backs off after HTTP_422 (no re-queue storm)', async () => {
    vi.mocked(ctx.client.submitActivity).mockResolvedValueOnce({
      ok: false,
      error: { code: 'HTTP_422', message: 'validation failed' },
    });

    await flush(ctx);
    expect(ctx.client.submitActivity).toHaveBeenCalledTimes(1);

    enqueue({ action: 'screen_view', metadata: { route: '/practice' } });
    await flush(ctx);
    // Still backed off — second flush should not hit the API.
    expect(ctx.client.submitActivity).toHaveBeenCalledTimes(1);
  });

  it('re-queues on transient 5xx failures', async () => {
    vi.mocked(ctx.client.submitActivity)
      .mockResolvedValueOnce({ ok: false, error: { code: 'HTTP_500', message: 'server error' } })
      .mockResolvedValueOnce({ ok: true, data: { accepted: 1, total: 1 } });

    await flush(ctx);
    await flush(ctx);
    expect(ctx.client.submitActivity).toHaveBeenCalledTimes(2);
  });
});

describe('rewards pushState — idempotent install', () => {
  const ctx: RewardsContext = {
    client: {
      submitActivity: vi.fn(),
      getMyTier: vi.fn(),
    } as unknown as RewardsContext['client'],
    config: {
      enabled: true,
      trackActivity: true,
      consentMode: 'explicit',
      flushIntervalMs: 30_000,
    },
    projectId: 'proj_pushstate',
    userId: 'user_pushstate',
  };

  beforeEach(() => {
    teardown();
    vi.clearAllMocks();
    localStorage.setItem('mushi_rewards_consent_proj_pushstate', '1');
  });

  afterEach(() => {
    teardown();
  });

  it('survives teardown → re-init and 100× pushState without stack overflow', () => {
    initRewards(ctx);
    expect(() => {
      for (let i = 0; i < 100; i++) {
        history.pushState({}, '', `/route-${i}`);
      }
    }).not.toThrow();

    teardown();
    initRewards(ctx);
    expect(() => {
      for (let i = 0; i < 100; i++) {
        history.pushState({}, '', `/reinit-${i}`);
      }
    }).not.toThrow();
  });

  it('double initRewards does not double-wrap pushState', () => {
    initRewards(ctx);
    const wrappedOnce = history.pushState;
    initRewards(ctx);
    expect(history.pushState).toBe(wrappedOnce);
    expect(() => history.pushState({}, '', '/double-init')).not.toThrow();
  });

  it('re-init while listeners installed but pushState already unwrapped (partial-state / HMR) does not stack-overflow', () => {
    // This is the regression path: the module-level `listenersInstalled` flag
    // was reset to false (e.g. by a raw `listenersInstalled = false` in an
    // HMR reload of a dependent) while the wrapper is still installed in the
    // browser's history object.  Naively calling initRewards() again would
    // read `origPushState` (which already points at the wrapper) and create a
    // recursive chain.
    //
    // We simulate this by:
    //   1. Init normally — wrapper installed, origPushState = native.
    //   2. Capture the native reference before install.
    //   3. Manually slip the wrapper back without going through teardown —
    //      i.e. as if listenersInstalled was reset mid-flight.
    //   4. Call initRewards() again — the partial-state branch must detect
    //      the stale install, tear down cleanly, and re-wrap without recursion.

    const native = history.pushState;
    initRewards(ctx);
    const firstWrapper = history.pushState;
    expect(firstWrapper).not.toBe(native); // wrapper installed

    // Simulate partial-state: teardown() resets listenersInstalled = false
    // but the wrapper is still in place.  We achieve this by calling teardown
    // and then manually re-installing just the wrapper (bypassing initRewards).
    teardown();
    history.pushState = firstWrapper; // re-install stale wrapper manually

    // Now re-init must not blow the stack — the partial-state branch should
    // detect the stale wrapper, call removeActivityListeners, then re-wrap.
    expect(() => initRewards(ctx)).not.toThrow();

    // After re-init, a fresh wrapper is installed (not the stale one), and
    // pushing routes must not recurse.
    expect(history.pushState).not.toBe(firstWrapper);
    expect(() => {
      for (let i = 0; i < 50; i++) {
        history.pushState({}, '', `/partial-state-${i}`);
      }
    }).not.toThrow();
  });
});
