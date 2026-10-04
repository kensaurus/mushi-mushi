import { describe, expect, it } from 'vitest'
import {
  HEARTBEAT_FRESH_MS,
  HEARTBEAT_STALE_MS,
  heartbeatStateFromKeys,
  heartbeatStateFromTimestamp,
  isLiveKey,
  freshestHeartbeatKey,
  latestHeartbeatAt,
} from './heartbeat'

const NOW = Date.parse('2026-08-16T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('heartbeatStateFromTimestamp', () => {
  it('distinguishes an absent field from an explicit null', () => {
    // The whole point: `undefined` means the backend never sent the column
    // (migration not deployed), which is NOT evidence of a dead SDK. Claiming
    // "not connected" there would mark every project on the page as broken.
    expect(heartbeatStateFromTimestamp(undefined, NOW)).toBe('unknown')
    expect(heartbeatStateFromTimestamp(null, NOW)).toBe('never')
  })

  it('buckets by recency', () => {
    expect(heartbeatStateFromTimestamp(ago(60_000), NOW)).toBe('fresh')
    expect(heartbeatStateFromTimestamp(ago(HEARTBEAT_FRESH_MS - 1), NOW)).toBe('fresh')
    expect(heartbeatStateFromTimestamp(ago(HEARTBEAT_FRESH_MS), NOW)).toBe('stale')
    expect(heartbeatStateFromTimestamp(ago(HEARTBEAT_STALE_MS - 1), NOW)).toBe('stale')
    expect(heartbeatStateFromTimestamp(ago(HEARTBEAT_STALE_MS), NOW)).toBe('dead')
    expect(heartbeatStateFromTimestamp(ago(365 * 24 * 3_600_000), NOW)).toBe('dead')
  })

  it('treats a future timestamp as fresh rather than falling through to dead', () => {
    // Server clock slightly ahead of the browser must not read as ancient.
    expect(heartbeatStateFromTimestamp(new Date(NOW + 60_000).toISOString(), NOW)).toBe('fresh')
  })

  it('degrades an unparseable timestamp to never instead of throwing', () => {
    expect(heartbeatStateFromTimestamp('not-a-date', NOW)).toBe('never')
  })
})

describe('isLiveKey', () => {
  it('excludes revoked and deactivated keys, includes bare ones', () => {
    expect(isLiveKey({})).toBe(true)
    expect(isLiveKey({ is_active: true })).toBe(true)
    expect(isLiveKey({ revoked: true })).toBe(false)
    expect(isLiveKey({ is_active: false })).toBe(false)
  })
})

describe('heartbeatStateFromKeys', () => {
  it('returns unknown only when the api_keys field is absent', () => {
    expect(heartbeatStateFromKeys(undefined, NOW)).toBe('unknown')
    expect(heartbeatStateFromKeys(null, NOW)).toBe('unknown')
  })

  it('reports zero live keys as never — the most disconnected state', () => {
    expect(heartbeatStateFromKeys([], NOW)).toBe('never')
    expect(heartbeatStateFromKeys([{ revoked: true, last_seen_at: ago(60_000) }], NOW)).toBe('never')
    expect(heartbeatStateFromKeys([{ is_active: false, last_seen_at: ago(60_000) }], NOW)).toBe(
      'never',
    )
  })

  it('takes the freshest heartbeat across live keys', () => {
    expect(
      heartbeatStateFromKeys(
        [
          { last_seen_at: ago(30 * 24 * 3_600_000) },
          { last_seen_at: ago(60_000) },
          { last_seen_at: null },
        ],
        NOW,
      ),
    ).toBe('fresh')
  })

  it('ignores a fresh heartbeat on a revoked key', () => {
    expect(
      heartbeatStateFromKeys(
        [
          { last_seen_at: ago(60_000), revoked: true },
          { last_seen_at: ago(3 * 24 * 3_600_000) },
        ],
        NOW,
      ),
    ).toBe('stale')
  })

  it('reports never when live keys exist but none has ever authenticated', () => {
    expect(heartbeatStateFromKeys([{ last_seen_at: null }, {}], NOW)).toBe('never')
  })
})

describe('latestHeartbeatAt / freshestHeartbeatKey', () => {
  it('returns the most recent check-in, not the first key that has one', () => {
    // glot.it on 2026-10-04: 13 keys; the first key with a timestamp was 108
    // days old while another key checked in 50 minutes earlier.
    const keys = [
      { id: 'old', is_active: true, last_seen_at: ago(108 * 24 * 3_600_000) },
      { id: 'never', is_active: true, last_seen_at: null },
      { id: 'recent', is_active: true, last_seen_at: ago(50 * 60_000) },
      { id: 'mid', is_active: true, last_seen_at: ago(3 * 24 * 3_600_000) },
    ]
    expect(latestHeartbeatAt(keys)).toBe(ago(50 * 60_000))
    expect(freshestHeartbeatKey(keys)?.id).toBe('recent')
  })

  it('compares instants, not strings, across timestamp formats', () => {
    const keys = [
      { last_seen_at: '2026-10-03T23:27:23.973+00:00' },
      { last_seen_at: '2026-10-03 22:00:00+00' },
    ]
    expect(latestHeartbeatAt(keys)).toBe('2026-10-03T23:27:23.973+00:00')
  })

  it('ignores revoked or inactive keys and unparseable timestamps', () => {
    expect(
      latestHeartbeatAt([
        { last_seen_at: ago(60_000), is_active: false },
        { last_seen_at: ago(60_000), revoked: true },
        { last_seen_at: 'garbage' },
      ]),
    ).toBeNull()
  })

  it('returns null for no keys', () => {
    expect(latestHeartbeatAt(undefined)).toBeNull()
    expect(latestHeartbeatAt([])).toBeNull()
  })
})
