/**
 * Journey optimizer helpers (owner, 2026-11-18): the score waits for a scan,
 * and the common paths rank by visits so they read without the flow map.
 */
import { describe, expect, it } from 'vitest'
import { journeyScoreStat, journeySdkState, journeyStartHints, rankedPaths } from './journeys'

describe('journeyScoreStat', () => {
  it('says not scanned yet, never "100 · no problems found", before a scan', () => {
    expect(journeyScoreStat(100, 0, false)).toEqual({ value: '—', detail: 'not scanned yet', tone: 'off' })
  })

  it('shows the score and what to look at once scanned', () => {
    expect(journeyScoreStat(100, 0, true)).toEqual({ value: '100', detail: 'no problems found', tone: 'ok' })
    expect(journeyScoreStat(42, 3, true)).toEqual({ value: '42', detail: '3 to look at', tone: 'danger' })
  })
})

describe('rankedPaths', () => {
  it('ranks most visits first with a share of all visits, capped at the limit', () => {
    const flows = [
      { pages: ['/', '/a'], sessions: 3 },
      { pages: ['/', '/b'], sessions: 9 },
      { pages: ['/', '/c'], sessions: 5 },
    ]
    const ranked = rankedPaths(flows, 20, 2)
    expect(ranked.map((r) => r.sessions)).toEqual([9, 5])
    expect(ranked[0].share).toBeCloseTo(0.45)
    expect(rankedPaths(flows, 0)[0].share).toBeNull()
  })
})

// Round-2 review: the empty state told an app with its SDK installed and
// sending to "Install the Mushi Mushi SDK", and the address field sat empty.
describe('journeySdkState', () => {
  const step = (complete: boolean, origin: string | null, seen: string | null = null) => [
    { id: 'project_created', complete: true },
    { id: 'sdk_installed', complete, diagnostic: { last_sdk_seen_at: seen, last_sdk_origin: origin } },
  ]
  it('reads installed and the public origin from the sdk_installed step', () => {
    expect(journeySdkState(step(true, 'https://kensaur.us'))).toEqual({ installed: true, origin: 'https://kensaur.us' })
    expect(journeySdkState(step(false, null, '2026-11-18T00:00:00Z')).installed).toBe(true)
    expect(journeySdkState(step(false, null))).toEqual({ installed: false, origin: null })
    expect(journeySdkState(null)).toEqual({ installed: false, origin: null })
  })
  it('never offers a localhost or app-scheme origin as the live site', () => {
    expect(journeySdkState(step(true, 'http://localhost:5173')).origin).toBeNull()
    expect(journeySdkState(step(true, 'capacitor://localhost')).origin).toBeNull()
  })
})

describe('journeyStartHints', () => {
  it('asks to turn on session tracking, not to install, when the SDK is in', () => {
    const [, visits] = journeyStartHints({ hasScan: false, hasVisits: false, sdkInstalled: true })
    expect(visits).toMatch(/^Turn on session tracking/)
    expect(visits).not.toMatch(/Install the Mushi Mushi SDK/)
    expect(journeyStartHints({ hasScan: false, hasVisits: false, sdkInstalled: false })[1]).toMatch(/^Install the Mushi Mushi SDK/)
    expect(journeyStartHints({ hasScan: true, hasVisits: true, sdkInstalled: true })).toEqual(['Site scan: done.', 'Visits: arriving.'])
  })
})

