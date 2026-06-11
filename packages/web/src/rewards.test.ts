import { describe, it, expect, vi, beforeEach } from 'vitest';
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
