import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  loads: 0,
  plans: [] as Array<Record<string, unknown>>,
  error: null as null | { message: string; statusCode?: number },
}));

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => ({
    from: () => ({
      select: () => ({
        order: async () => {
          state.loads += 1;
          return { data: state.plans, error: state.error };
        },
      }),
    }),
  }),
}));

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => noop,
  };
  return { log: noop };
});

const { getPlan, invalidatePlanCache, listPlans } =
  await import('../../supabase/functions/_shared/plans.ts');

describe('pricing plan warm-isolate cache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T00:00:00.000Z'));
    state.loads = 0;
    state.error = null;
    state.plans = [
      {
        id: 'pro',
        display_name: 'Pro',
        position: 12,
        feature_flags: { byok: true },
      },
    ];
    invalidatePlanCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reuses a fresh catalog but reloads it after the entitlement TTL', async () => {
    await listPlans();
    await listPlans();
    expect(state.loads).toBe(1);

    state.plans = [
      {
        id: 'pro',
        display_name: 'Pro',
        position: 12,
        feature_flags: { byok: false },
      },
    ];
    vi.advanceTimersByTime(60_001);

    const refreshed = await listPlans();
    expect(state.loads).toBe(2);
    expect(refreshed[0]?.feature_flags).toMatchObject({ byok: false });
  });

  it('serves the last known-good paid catalog when a refresh fails', async () => {
    await listPlans();
    vi.advanceTimersByTime(60_001);
    state.error = { message: 'Bad Gateway', statusCode: 503 };

    const stale = await getPlan('pro');
    expect(state.loads).toBe(2);
    expect(stale.feature_flags).toMatchObject({ byok: true });

    await getPlan('pro');
    expect(state.loads).toBe(2);
  });

  it('uses a short conservative fallback only when no catalog was loaded', async () => {
    state.error = { message: 'Bad Gateway', statusCode: 503 };

    const fallback = await getPlan('pro');
    expect(fallback.id).toBe('free_cloud');
    expect(fallback.feature_flags).toMatchObject({ byok: false });

    await getPlan('pro');
    expect(state.loads).toBe(1);
  });
});
