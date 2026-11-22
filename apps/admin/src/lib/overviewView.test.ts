/**
 * Overview card states (round-2 sweep 2026-11-18): one name and one colour per
 * state. "Silent" (amber) and "Quiet" (grey) read as the same state, and an
 * open-bug count was painted amber like a warning.
 */
import { describe, expect, it } from 'vitest'
import { HEALTH_BADGE_TONE, healthBadgeLabel, healthToneFor, splitBySessions } from './overviewView'

const RECENT = new Date().toISOString()
const card = (over: Partial<Parameters<typeof healthToneFor>[0]> = {}) => ({
  critical_reports: 0,
  open_reports: 0,
  sessions_7d: 10,
  last_seen_at: RECENT,
  ...over,
})

describe('Overview card states', () => {
  it('names a stopped SDK apart from an app nobody used this week', () => {
    const stopped = card({ last_seen_at: '2026-01-01T00:00:00Z', sessions_7d: 0 })
    expect(healthToneFor(stopped)).toBe('silent')
    expect(healthBadgeLabel(stopped, 'silent')).toBe('SDK stopped')
    expect(HEALTH_BADGE_TONE.silent).toBe('warnSubtle')

    const quiet = card({ sessions_7d: 0 })
    expect(healthToneFor(quiet)).toBe('quiet')
    // "No sessions this week" is said once, in the stats row: no badge.
    expect(healthBadgeLabel(quiet, 'quiet')).toBeNull()
  })

  it('shows an open-bug count as a neutral count, critical stays red', () => {
    const busy = card({ open_reports: 49 })
    expect(healthToneFor(busy)).toBe('warn')
    expect(healthBadgeLabel(busy, 'warn')).toBe('49 open')
    expect(HEALTH_BADGE_TONE.warn).toBe('neutral')
    expect(HEALTH_BADGE_TONE.critical).toBe('dangerSubtle')
  })
})

describe('splitBySessions (round-3 sweep)', () => {
  it('moves apps with no sessions this week to one list and keeps the order', () => {
    const cards = [card({ sessions_7d: 0, critical_reports: 2 }), card({ sessions_7d: 5 }), card({ sessions_7d: 0 })]
    const { active, idle } = splitBySessions(cards)
    expect(active).toEqual([cards[1]])
    expect(idle).toEqual([cards[0], cards[2]])
  })
})
