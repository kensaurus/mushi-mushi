/**
 * @vitest-environment jsdom
 *
 * FILE: apps/admin/src/lib/checkSignals.test.ts
 * PURPOSE: /checks signals: "14d ago" grades worse than "now", the change since the last
 * visit is only shown against a remembered count, a partial read never resets that count,
 * and the alert cards rank failed, then findings, then stale runs; an unread, unrun or
 * unset check is never an alert.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { CheckCardView } from './checkCardStatus'
import { baselineSnapshot, checkAlerts, countChange, readBaseline, signalCount, staleness, STALE_DAYS, writeBaseline } from './checkSignals'

const NOW = Date.parse('2026-11-18T12:00:00Z')
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

function view(state: CheckCardView['state'], over: Partial<CheckCardView> = {}): CheckCardView {
  return { state, chip: state, detail: null, setupTo: null, tone: 'neutral', ...over }
}

beforeEach(() => window.localStorage.clear())

describe('staleness', () => {
  it('grades a run 14 days old darker than one from just now, with a worse shape', () => {
    const fresh = staleness(ago(0.2), NOW)!
    const old = staleness(ago(14 * 24), NOW)!
    expect(fresh).toMatchObject({ short: 'now', cellClass: 'ci-cell-0', tone: 'ok', stale: false })
    expect(old).toMatchObject({ short: '14d', cellClass: 'ci-fail-5', tone: 'danger', stale: true })
    expect(staleness(ago(5), NOW)).toMatchObject({ short: '5h', tone: 'ok' })
    // An age under a week is not a failure: neutral, no warning shape (2026-11-18).
    expect(staleness(ago(3 * 24), NOW)).toMatchObject({ short: '3d', tone: 'ok', cellClass: 'ci-cell-0', stale: false })
    expect(staleness(ago(4 * 24), NOW)).toMatchObject({ short: '4d', tone: 'ok', cellClass: 'ci-cell-0' })
    expect(staleness(ago(STALE_DAYS * 24), NOW)?.stale).toBe(true)
  })

  it('has nothing to say without a usable time', () => {
    expect(staleness(null, NOW)).toBeNull()
    expect(staleness('not a date', NOW)).toBeNull()
  })
})

describe('change since the last visit', () => {
  it('counts results only, and shows a change only against a remembered count', () => {
    expect(signalCount(view('findings', { count: 4 }))).toBe(4)
    expect(signalCount(view('failed'))).toBe(1)
    expect(signalCount(view('pass'))).toBe(0)
    expect(signalCount(view('unavailable'))).toBeNull()
    expect(signalCount(view('not_set_up'))).toBeNull()
    expect(countChange('/a', view('findings', { count: 4 }), null)).toBeNull()
    expect(countChange('/a', view('findings', { count: 4 }), { '/a': 1 })).toEqual({ text: '▲ +3', worse: true })
    expect(countChange('/a', view('pass'), { '/a': 2 })).toEqual({ text: '▼ −2', worse: false })
    expect(countChange('/a', view('findings', { count: 2 }), { '/a': 2 })).toBeNull()
  })

  it('never takes a snapshot while a card is loading or unread', () => {
    expect(baselineSnapshot([{ path: '/a', view: view('pass') }, { path: '/b', view: null }])).toBeNull()
    expect(baselineSnapshot([{ path: '/a', view: view('unavailable') }])).toBeNull()
    expect(baselineSnapshot([{ path: '/a', view: view('findings', { count: 2 }) }, { path: '/b', view: view('not_set_up') }])).toEqual({ '/a': 2 })
  })

  it('remembers counts per app and survives junk in storage', () => {
    writeBaseline('p1', { '/a': 3 })
    expect(readBaseline('p1')).toEqual({ '/a': 3 })
    expect(readBaseline('p2')).toBeNull()
    window.localStorage.setItem('mushi:checks-baseline:p3', '{not json')
    expect(readBaseline('p3')).toBeNull()
    expect(readBaseline(null)).toBeNull()
  })
})

describe('checkAlerts', () => {
  const card = (path: string, v: CheckCardView | null) => ({ path, label: path.slice(1).toUpperCase(), description: 'desc', view: v })

  it('ranks failed, then findings biggest first, then stale passes oldest first', () => {
    const alerts = checkAlerts(
      [
        card('/stale', view('pass', { lastRunAt: ago(9 * 24) })),
        card('/older', view('pass', { lastRunAt: ago(20 * 24) })),
        card('/two', view('findings', { count: 2, lastRunAt: ago(1) })),
        card('/five', view('findings', { count: 5, lastRunAt: ago(1) })),
        card('/red', view('failed', { lastRunAt: ago(2) })),
        card('/fresh', view('pass', { lastRunAt: ago(1) })),
      ],
      { '/five': 2 },
      NOW,
    )
    expect(alerts.map((a) => a.id)).toEqual(['red', 'five', 'two', 'older', 'stale'])
    expect(alerts[0]).toMatchObject({ severity: 'critical', title: 'RED failed', action: { to: '/red' } })
    expect(alerts[1]).toMatchObject({ severity: 'serious', label: 'Getting worse', metric: { value: '5', unit: 'findings · ▲ +3' } })
    expect(alerts[2]?.metric).toEqual({ value: '2', unit: 'findings' })
    expect(alerts[3]).toMatchObject({ label: 'Stale 20d', metric: { value: '20d', unit: 'since last run' } })
  })

  it('never alerts on a check that was not read, has not run, is not set up, or only watches', () => {
    const alerts = checkAlerts(
      [card('/u', view('unavailable')), card('/n', view('not_checked', { lastRunAt: ago(30 * 24) })), card('/s', view('not_set_up')), card('/w', view('watching')), card('/l', null)],
      null,
      NOW,
    )
    expect(alerts).toEqual([])
  })
})
