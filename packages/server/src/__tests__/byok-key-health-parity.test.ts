/**
 * FILE: byok-key-health-parity.test.ts
 * The settings stats route (sidebar badge, page hero) counts keys with the
 * server's byok-key-health.ts; the key rows and the page banner use
 * keyStatus.ts. Both run here on the same keys and must give the same answer.
 */
import { describe, expect, it } from 'vitest'
import {
  byokKeyHealth,
  legacyKeyStatus,
  type ByokKeyHealthInput,
} from '../../supabase/functions/_shared/byok-key-health.ts'
import type { PoolKey, PoolTestStatus } from '../../../../apps/admin/src/components/settings/byokPool.ts'
import { keyStatusView, type LegacyKey } from '../../../../apps/admin/src/components/settings/keyStatus.ts'

const NOW = Date.parse('2026-10-04T12:00:00Z')
const H = 60 * 60 * 1000
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString()

function pool(id: string, over: Partial<PoolKey> = {}): PoolKey {
  return {
    id,
    provider_slug: 'anthropic',
    label: null,
    priority: 100,
    status: 'active',
    key_hint: null,
    base_url: null,
    test_status: 'ok',
    last_tested_at: iso(-H),
    last_used_at: null,
    cooldown_until: null,
    created_at: iso(-24 * H),
    expires_at: null,
    ...over,
  }
}

function legacy(provider: string, testStatus: PoolTestStatus | null): LegacyKey {
  return {
    id: `legacy:${provider}`,
    provider_slug: provider,
    label: 'Legacy credential',
    status: legacyKeyStatus(testStatus) as LegacyKey['status'],
    test_status: testStatus,
    cooldown_until: null,
    key_hint: null,
    base_url: null,
    last_tested_at: null,
    last_used_at: null,
    created_at: null,
    legacy: true,
  }
}

/** The client's five states mapped onto the server's counting buckets. */
function clientBucket(state: string): string {
  return state === 'not_connected' ? 'off' : state
}

const SCENARIOS: Array<{ name: string; pool: PoolKey[]; legacy: LegacyKey[] }> = [
  { name: 'working key', pool: [pool('a')], legacy: [] },
  { name: 'rejected key', pool: [pool('a', { status: 'auth_failed', test_status: 'error_auth' })], legacy: [] },
  {
    name: 'quota, cooling down',
    pool: [pool('a', { status: 'quota_exhausted', test_status: 'error_quota', cooldown_until: iso(H) })],
    legacy: [],
  },
  {
    name: 'quota, cooldown over',
    pool: [pool('a', { status: 'quota_exhausted', test_status: 'error_quota', cooldown_until: iso(-H) })],
    legacy: [],
  },
  { name: 'never tested', pool: [pool('a', { status: 'pending_validation', test_status: null })], legacy: [] },
  { name: 'unreachable', pool: [pool('a', { status: 'pending_validation', test_status: 'error_network' })], legacy: [] },
  { name: 'turned off', pool: [pool('a', { status: 'disabled' })], legacy: [] },
  { name: 'expired', pool: [pool('a', { expires_at: iso(-H) })], legacy: [] },
  { name: 'expiring soon', pool: [pool('a', { expires_at: iso(3 * 24 * H) })], legacy: [] },
  { name: 'expiry far away', pool: [pool('a', { expires_at: iso(60 * 24 * H) })], legacy: [] },
  { name: 'legacy alone, tested ok', pool: [], legacy: [legacy('anthropic', 'ok')] },
  { name: 'legacy alone, never tested', pool: [], legacy: [legacy('openai', null)] },
  { name: 'legacy beside a working pool key', pool: [pool('a')], legacy: [legacy('anthropic', 'ok')] },
  {
    name: 'legacy beside a broken pool key',
    pool: [pool('a', { status: 'auth_failed', test_status: 'error_auth' })],
    legacy: [legacy('anthropic', 'ok')],
  },
  {
    name: 'rejected key beside a working one',
    pool: [pool('a'), pool('b', { status: 'auth_failed', test_status: 'error_auth' })],
    legacy: [],
  },
  {
    name: 'mixed providers',
    pool: [
      pool('a', { provider_slug: 'openai' }),
      pool('b', { provider_slug: 'firecrawl', status: 'pending_validation', test_status: null }),
    ],
    legacy: [legacy('firecrawl', 'error_auth')],
  },
]

describe('key status parity: console rows ⇄ server counts', () => {
  it.each(SCENARIOS)('$name', ({ pool: poolKeys, legacy: legacyKeys }) => {
    const serverInputs: ByokKeyHealthInput[] = [
      ...poolKeys.map((k) => ({
        provider_slug: k.provider_slug,
        status: k.status,
        test_status: k.test_status,
        cooldown_until: k.cooldown_until,
        expires_at: k.expires_at ?? null,
      })),
      ...legacyKeys.map((k) => ({
        provider_slug: k.provider_slug,
        status: k.status,
        test_status: k.test_status,
        legacy: true,
      })),
    ]
    const client = [...poolKeys, ...legacyKeys].map((k) =>
      clientBucket(keyStatusView(k, { pool: poolKeys, now: NOW }).state),
    )
    const server = serverInputs.map((k) => byokKeyHealth(k, serverInputs, NOW))
    expect(server).toEqual(client)
  })
})
