import { describe, expect, it } from 'vitest'
import type { PoolKey } from './byokPool'
import {
  keyStatusView,
  providerStatusView,
  summarizeKeys,
  type LegacyKey,
} from './keyStatus'

const NOW = Date.parse('2026-10-04T12:00:00Z')
const H = 60 * 60 * 1000
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString()

function pool(over: Partial<PoolKey> = {}): PoolKey {
  return {
    id: 'k1',
    provider_slug: 'anthropic',
    label: null,
    priority: 100,
    status: 'active',
    key_hint: 'sk-ant-…0001',
    base_url: null,
    test_status: 'ok',
    last_tested_at: iso(-2 * H),
    last_used_at: null,
    cooldown_until: null,
    created_at: iso(-48 * H),
    expires_at: null,
    ...over,
  }
}

function legacy(over: Partial<LegacyKey> = {}): LegacyKey {
  return {
    id: 'legacy:anthropic',
    provider_slug: 'anthropic',
    label: 'Legacy credential',
    status: 'active',
    test_status: 'ok',
    cooldown_until: null,
    key_hint: 'sk-ant-…9999',
    base_url: null,
    last_tested_at: iso(-H),
    last_used_at: null,
    created_at: null,
    legacy: true,
    ...over,
  }
}

const view = (key: PoolKey | LegacyKey, keys: PoolKey[] = []) =>
  keyStatusView(key, { pool: keys, now: NOW, providerName: 'Anthropic' })

describe('keyStatusView', () => {
  it('a tested, active key is working and says when it was verified', () => {
    expect(view(pool())).toEqual({ state: 'working', detail: 'Verified 2h ago', action: null })
    expect(view(pool({ last_used_at: iso(-H / 2) })).detail).toBe('Verified 2h ago · last used 30m ago')
  })

  it('a rejected key needs attention and offers Replace', () => {
    const v = view(pool({ status: 'auth_failed', test_status: 'error_auth' }))
    expect(v).toMatchObject({ state: 'attention', action: 'replace' })
    expect(v.detail).toBe('The provider rejected this key — replace it.')
  })

  it('a key out of quota says until when, and offers a backup key', () => {
    const v = view(pool({ status: 'quota_exhausted', test_status: 'error_quota', cooldown_until: iso(H) }))
    expect(v.state).toBe('attention')
    expect(v.action).toBe('add_backup')
    expect(v.detail).toMatch(/^Out of quota — add another key or wait until /)
  })

  it('a quota key whose cooldown is over is back in use', () => {
    const v = view(pool({ status: 'quota_exhausted', test_status: 'error_quota', cooldown_until: iso(-H) }))
    expect(v.state).toBe('working')
  })

  it('a saved but untested key is "not checked yet", never working', () => {
    expect(view(pool({ status: 'pending_validation', test_status: null, last_tested_at: null }))).toMatchObject({
      state: 'checking',
      action: 'test',
    })
  })

  it('an unreachable provider asks for a re-test, naming the provider', () => {
    const v = view(pool({ status: 'pending_validation', test_status: 'error_network' }))
    expect(v).toMatchObject({ state: 'attention', action: 'test' })
    expect(v.detail).toContain('Anthropic')
  })

  it('a turned-off key says so; it can be turned back on only if it tested ok', () => {
    expect(view(pool({ status: 'disabled' }))).toMatchObject({
      state: 'not_connected',
      label: 'Turned off',
      action: 'enable',
    })
    expect(view(pool({ status: 'disabled', test_status: 'error_auth' })).action).toBe('test')
  })

  it('warns 7 days before an expiry date and flags an expired key', () => {
    expect(view(pool({ expires_at: iso(30 * 24 * H) })).state).toBe('working')
    const soon = view(pool({ expires_at: iso(5 * 24 * H) }))
    expect(soon).toMatchObject({ state: 'expiring', action: 'replace' })
    const gone = view(pool({ expires_at: iso(-H) }))
    expect(gone).toMatchObject({ state: 'attention', label: 'Expired', action: 'replace' })
  })

  it('an old single key next to a working pooled key must be removed', () => {
    const working = pool()
    expect(view(legacy(), [working])).toEqual({
      state: 'attention',
      label: 'Old key',
      detail: 'Old key, replaced by your newer one — remove it.',
      action: 'remove',
    })
    // With no working pooled key the old key is the one in use.
    expect(view(legacy(), [pool({ status: 'auth_failed', test_status: 'error_auth' })]).state).toBe('working')
  })
})

describe('summarizeKeys', () => {
  it('counts every key once, by the same rules as the rows', () => {
    const keys = [
      pool(),
      pool({ id: 'k2', status: 'auth_failed', test_status: 'error_auth' }),
      pool({ id: 'k3', provider_slug: 'openai', status: 'pending_validation', test_status: null }),
      pool({ id: 'k4', provider_slug: 'cursor', expires_at: iso(2 * 24 * H) }),
      pool({ id: 'k5', provider_slug: 'firecrawl', status: 'disabled' }),
    ]
    expect(summarizeKeys(keys, [legacy()], NOW)).toEqual({
      working: 1,
      attention: 2, // rejected key + superseded legacy key
      expiring: 1,
      checking: 1,
      off: 1,
      total: 6,
    })
  })
})

describe('providerStatusView', () => {
  const opts = { now: NOW, providerName: 'Anthropic', emptyDetail: 'Using Mushi’s shared key.' }

  it('no keys reads "not connected" with the provider-specific note', () => {
    expect(providerStatusView('anthropic', [], [], opts)).toEqual({
      state: 'not_connected',
      detail: 'Using Mushi’s shared key.',
      action: null,
    })
  })

  it('a working provider with a broken spare key still asks for attention', () => {
    const v = providerStatusView(
      'anthropic',
      [pool(), pool({ id: 'k2', status: 'auth_failed', test_status: 'error_auth' })],
      [],
      opts,
    )
    expect(v.state).toBe('attention')
    expect(v.detail).toMatch(/^Working, but one key needs your attention/)
  })

  it('the only key failing makes the provider need attention with that key’s reason', () => {
    const v = providerStatusView('anthropic', [pool({ status: 'auth_failed', test_status: 'error_auth' })], [], opts)
    expect(v).toMatchObject({ state: 'attention', detail: 'The provider rejected this key — replace it.' })
  })
})
