/**
 * Connect's "Revoke N stale keys" (owner, 2026-11-18) takes only SDK keys
 * nobody has used for over a week, and never the key the app runs on.
 */
import { describe, expect, it } from 'vitest'
import { staleKeysToRevoke, type StaleKeyCandidate } from './staleKeys'

const NOW = Date.parse('2026-11-18T00:00:00Z')
const DAY = 86_400_000
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString()
const key = (id: string, over: Partial<StaleKeyCandidate> = {}): StaleKeyCandidate => ({
  id,
  key_prefix: `mushi_${id}`,
  label: 'sdk-ingest',
  scopes: ['report:write'],
  is_active: true,
  created_at: iso(60),
  ...over,
})

describe('staleKeysToRevoke', () => {
  it('takes cold keys and old never-used keys, nothing used this week', () => {
    const keys = [
      key('live', { last_seen_at: iso(0.01) }),
      key('quiet', { last_seen_at: iso(3) }),
      key('cold', { last_seen_at: iso(30) }),
      key('never-old', { created_at: iso(20) }),
      key('never-new', { created_at: iso(2) }),
    ]
    expect(staleKeysToRevoke(keys, NOW).map((k) => k.id)).toEqual(['cold', 'never-old'])
  })

  it('never takes the key most recently heard from, even when it is cold', () => {
    const keys = [key('a', { last_seen_at: iso(40) }), key('b', { last_seen_at: iso(90) })]
    expect(staleKeysToRevoke(keys, NOW).map((k) => k.id)).toEqual(['b'])
  })

  it('leaves MCP keys, ci-auto keys, revoked keys and rows without a real id', () => {
    const keys = [
      key('live', { last_seen_at: iso(0.01) }),
      key('mcp', { scopes: ['mcp:read'], last_seen_at: iso(30) }),
      key('ci', { label: 'ci-auto:acme/app', last_seen_at: iso(30) }),
      key('gone', { is_active: false, last_seen_at: iso(30) }),
      { ...key('x', { last_seen_at: iso(30) }), id: 'mushi_x' },
    ]
    expect(staleKeysToRevoke(keys, NOW)).toEqual([])
  })
})
