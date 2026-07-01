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

  it('re-init after stale hub wrapper left on history does not stack-overflow', () => {
    initRewards(ctx);
    const hubWrapper = history.pushState;
    expect(hubWrapper).not.toBe(History.prototype.pushState);

    teardown();
    history.pushState = hubWrapper;

    expect(() => initRewards(ctx)).not.toThrow();
    expect(() => {
      for (let i = 0; i < 50; i++) {
        history.pushState({}, '', `/partial-state-${i}`);
      }
    }).not.toThrow();
  });

  it('replaceState does not emit screen_view_unique_per_day (pre-hub behavior)', async () => {
    initRewards(ctx);
    vi.mocked(ctx.client.submitActivity).mockResolvedValue({
      ok: true,
      data: { accepted: 1, total: 1 },
    });

    history.pushState({}, '', '/via-push');
    history.replaceState({}, '', '/via-replace');

    await flush(ctx);

    expect(ctx.client.submitActivity).toHaveBeenCalledTimes(1);
    const batch = vi.mocked(ctx.client.submitActivity).mock.calls[0]?.[1] ?? [];
    const routes = batch
      .filter((e) => e.action === 'screen_view_unique_per_day')
      .map((e) => e.metadata?.route);
    expect(routes).toEqual(['/via-push']);
  });
});
