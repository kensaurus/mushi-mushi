import { describe, expect, it, vi } from 'vitest';
import {
  isRuntimeEligiblePoolKey,
  providerPoolKeys,
  selectPrimaryProviderKey,
  type PoolKey,
} from './byokPool';

function key(overrides: Partial<PoolKey>): PoolKey {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    provider_slug: 'firecrawl',
    label: null,
    priority: 100,
    status: 'active',
    key_hint: 'fc-…1234',
    base_url: null,
    test_status: 'ok',
    last_tested_at: null,
    last_used_at: null,
    cooldown_until: null,
    created_at: '2026-08-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('BYOK pool selection', () => {
  it('matches runtime eligibility across lifecycle and probe statuses', () => {
    const now = Date.parse('2026-08-06T12:00:00.000Z');
    expect(isRuntimeEligiblePoolKey(key({ status: 'active', test_status: 'ok' }), now)).toBe(true);
    expect(
      isRuntimeEligiblePoolKey(
        key({
          status: 'quota_exhausted',
          test_status: 'error_quota',
          cooldown_until: '2026-08-06T11:59:59.000Z',
        }),
        now,
      ),
    ).toBe(true);
    expect(isRuntimeEligiblePoolKey(key({ status: 'pending_validation', test_status: null }))).toBe(
      false,
    );
    expect(
      isRuntimeEligiblePoolKey(key({ status: 'auth_failed', test_status: 'error_auth' })),
    ).toBe(false);
    expect(
      isRuntimeEligiblePoolKey(
        key({
          status: 'quota_exhausted',
          test_status: 'error_quota',
          cooldown_until: '2026-08-06T12:00:01.000Z',
        }),
        now,
      ),
    ).toBe(false);
    expect(
      isRuntimeEligiblePoolKey(
        key({ status: 'active', test_status: 'ok', cooldown_until: 'not-a-timestamp' }),
        now,
      ),
    ).toBe(false);
  });

  it('prefers a runnable fallback over a higher-priority quarantined key', () => {
    const quarantined = key({
      id: '00000000-0000-4000-8000-000000000002',
      priority: 10,
      status: 'auth_failed',
      test_status: 'error_auth',
    });
    const runnable = key({
      id: '00000000-0000-4000-8000-000000000003',
      priority: 20,
    });

    expect(selectPrimaryProviderKey([quarantined, runnable], 'firecrawl')?.id).toBe(runnable.id);
  });

  it('selects a quota-exhausted key after its cooldown expires', () => {
    const now = Date.parse('2026-08-06T12:00:00.000Z');
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
    const cooledDown = key({
      id: '00000000-0000-4000-8000-000000000006',
      priority: 10,
      status: 'quota_exhausted',
      test_status: 'error_quota',
      cooldown_until: '2026-08-06T11:59:59.000Z',
    });
    const fallback = key({
      id: '00000000-0000-4000-8000-000000000007',
      priority: 20,
    });

    try {
      expect(selectPrimaryProviderKey([cooledDown, fallback], 'firecrawl')?.id).toBe(cooledDown.id);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('returns the highest-priority quarantined row when none are runnable', () => {
    const rows = [
      key({ id: '00000000-0000-4000-8000-000000000004', priority: 50, status: 'disabled' }),
      key({ id: '00000000-0000-4000-8000-000000000005', priority: 10, status: 'auth_failed' }),
    ];

    expect(providerPoolKeys(rows, 'firecrawl').map((row) => row.priority)).toEqual([10, 50]);
    expect(selectPrimaryProviderKey(rows, 'firecrawl')?.priority).toBe(10);
    expect(selectPrimaryProviderKey(rows, 'browserbase')).toBeNull();
  });
});
