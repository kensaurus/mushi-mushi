import { describe, expect, it } from 'vitest'
import { spendDownLine, spendDownStops, type SpendDownKeyStatus } from './spendDown'

const base: SpendDownKeyStatus = {
  id: 'k',
  label: 'ayako',
  keyHint: 'crsr_…a1b2',
  scope: 'organization',
  status: 'active',
  enabled: true,
  creditsExpireAt: '2026-10-31T23:59:59Z',
  model: null,
  dailyLimit: 10,
  windowDays: 14,
  state: 'active',
  startsAt: '2026-10-17T23:59:59Z',
  dispatchedToday: 3,
  remainingToday: 7,
  projects: [
    { id: 'p1', name: 'tsumagoi' },
    { id: 'p2', name: 'yen-yen' },
  ],
  lastRunAt: null,
  lastSummary: null,
}

describe('spendDownLine', () => {
  it('says what it spends today, until when, and for which apps', () => {
    expect(spendDownLine(base)).toEqual({
      text: 'Spending down: 3 of 10 fixes today, until Oct 31, 2026. Pays for tsumagoi, yen-yen.',
      tone: 'ok',
    })
  })

  it('warns when the key is on but no app uses it', () => {
    expect(spendDownLine({ ...base, projects: [] }).tone).toBe('warn')
  })

  it('names the start date before the window, and stops after expiry', () => {
    expect(spendDownLine({ ...base, state: 'not_started', dailyLimit: 1 }).text).toBe(
      'Starts Oct 17, 2026: up to 1 fix a day until the credits expire on Oct 31, 2026.',
    )
    expect(spendDownLine({ ...base, state: 'expired' }).text).toContain('expired on Oct 31, 2026')
    expect(spendDownLine({ ...base, state: 'off' }).text).toBe('Spend-down is off.')
    expect(spendDownLine({ ...base, state: 'key_unusable' }).tone).toBe('warn')
  })
})

describe('spendDownStops', () => {
  it('lists apps the last tick skipped, with the reason', () => {
    expect(
      spendDownStops({
        ...base,
        lastSummary: {
          projects: [
            { projectId: 'p1', dispatched: 2 },
            { projectId: 'p2', dispatched: 0, stopped: 'Daily auto-fix dispatch quota reached (3/3).' },
          ],
        },
      }),
    ).toEqual(['yen-yen: Daily auto-fix dispatch quota reached (3/3).'])
  })
})
