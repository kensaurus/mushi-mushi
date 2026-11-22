/**
 * /credits view rules (round-2 review 2026-11-18): the offline-workers blocker
 * leads in red, the spend-down nudge is amber, an expired key has no live
 * switch, an unused key is a pill, and the Firecrawl table is worst first with
 * an honest last-audit pill.
 */

import { describe, expect, it } from 'vitest'
import {
  appsWorstFirst,
  auditRunStatus,
  auditScheduleSummary,
  countdownDisplayTone,
  countdownStatusTone,
  creditsBlocker,
  spendDownSwitchLocked,
  spendDownUnused,
  watchSummary,
} from './creditsView'
import type { WorkLanesData } from './workers'

describe('countdown colours', () => {
  it('draws a few days left with spend-down off amber, not red; out of credits stays red', () => {
    expect(countdownDisplayTone({ tone: 'danger', idle: true })).toBe('warn')
    // Out of credits: a real failure (idle is false on that card).
    expect(countdownDisplayTone({ tone: 'danger', idle: false })).toBe('danger')
    expect(countdownDisplayTone({ tone: 'ok', idle: false })).toBe('ok')
    expect(countdownStatusTone(false, 1)).toBe('warn')
    expect(countdownStatusTone(true, 1)).toBe('danger')
    expect(countdownStatusTone(false, 0)).toBe('ok')
  })
})

describe('creditsBlocker', () => {
  const data = (flags: unknown[]): WorkLanesData =>
    ({
      generatedAt: '2026-11-18T00:00:00Z',
      projects: [],
      hosts: [
        { id: 'h1', hostname: 'alienwarex16', online: false },
        { id: 'h2', hostname: 'nuc', online: true },
      ],
      lanes: [
        { id: 'l1', hostId: 'h1' },
        { id: 'l2', hostId: 'h1' },
        { id: 'l3', hostId: 'h2' },
      ],
      flags,
    }) as unknown as WorkLanesData

  const idleFlag = { id: 'credits_idle', kind: 'credits_idle', severity: 'danger', title: 'Cursor credits idle for 33 h', cause: 'alienwarex16 is offline.', sinceSec: 33 * 3600 }

  it('is the credits_idle flag with the offline lanes and machines, critical when the flag is danger', () => {
    expect(creditsBlocker(data([idleFlag]))).toEqual({
      severity: 'critical',
      title: 'Cursor credits idle for 33 h',
      cause: 'alienwarex16 is offline.',
      offlineLanes: 2,
      offlineHosts: ['alienwarex16'],
      idleHours: 33,
    })
    expect(creditsBlocker(data([{ ...idleFlag, severity: 'warn' }]))?.severity).toBe('serious')
  })

  it('is null without the flag, for the out-of-credits flag, and while loading', () => {
    expect(creditsBlocker(data([]))).toBeNull()
    expect(creditsBlocker(data([{ ...idleFlag, id: 'credits_out' }]))).toBeNull()
    expect(creditsBlocker(null)).toBeNull()
  })
})

describe('spend-down switch rows', () => {
  it('locks the switch for an expired key and for one with no expiry date that is off', () => {
    expect(spendDownSwitchLocked({ state: 'expired', enabled: false, creditsExpireAt: '2026-11-01T00:00:00Z' })).toBe(true)
    expect(spendDownSwitchLocked({ state: 'off', enabled: false, creditsExpireAt: null })).toBe(true)
    expect(spendDownSwitchLocked({ state: 'off', enabled: false, creditsExpireAt: '2026-12-01T00:00:00Z' })).toBe(false)
  })
  it('marks an active key that no app sends bugs through as unused', () => {
    expect(spendDownUnused({ state: 'active', projects: [], otherApps: 0, idleNote: null })).toBe(true)
    expect(spendDownUnused({ state: 'active', projects: [{}], otherApps: 0 })).toBe(false)
    expect(spendDownUnused({ state: 'active', projects: [], otherApps: 2 })).toBe(false)
    expect(spendDownUnused({ state: 'off', projects: [], otherApps: 0 })).toBe(false)
  })
})

describe('Firecrawl table', () => {
  const NOW = Date.parse('2026-11-18T00:00:00Z')
  const audit = (over: Record<string, unknown> = {}) => ({
    enabled: true,
    batch_id: null,
    next_run_at: null,
    last_run_at: '2026-11-13T00:00:00Z',
    last_error: null,
    ...over,
  })

  it('draws the last audit honestly: failing count red, pass only after a run, hollow when never run', () => {
    expect(auditRunStatus(audit(), 4, NOW)).toEqual({ status: 'failed', label: '4 failing' })
    expect(auditRunStatus(audit(), 0, NOW)).toEqual({ status: 'passed', label: 'Passed' })
    expect(auditRunStatus(audit({ last_run_at: null }), 0, NOW).status).toBe('idle')
    expect(auditRunStatus(null, 0, NOW)).toEqual({ status: 'idle', label: 'No audit' })
    expect(auditRunStatus(audit({ batch_id: 'b' }), 0, NOW).status).toBe('running')
    expect(auditRunStatus(audit({ last_error: 'HTTP 402' }), 0, NOW)).toEqual({ status: 'failed', label: 'Error' })
  })

  it('sorts apps worst first and keeps the order of ties', () => {
    const apps = [
      { name: 'a', audit: audit(), auditFindings: 0 },
      { name: 'b', audit: audit(), auditFindings: 1 },
      { name: 'c', audit: audit(), auditFindings: 4 },
      { name: 'd', audit: null, auditFindings: 0 },
      { name: 'e', audit: null, auditFindings: 0, error: 'Could not read' },
    ]
    expect(appsWorstFirst(apps).map((a) => a.name)).toEqual(['e', 'c', 'b', 'a', 'd'])
  })

  it('names the watch and the audit schedule as separate jobs', () => {
    expect(watchSummary({ page_limit: 100 })).toBe('Daily · 100 pages')
    expect(watchSummary(null)).toBeNull()
    expect(auditScheduleSummary({ enabled: true, cadence_days: 7, page_limit: 200 })).toBe('Weekly · 200 pages')
    expect(auditScheduleSummary({ enabled: true, cadence_days: 3, page_limit: 50 })).toBe('Every 3 days · 50 pages')
    expect(auditScheduleSummary({ enabled: false, cadence_days: 7, page_limit: 200 })).toBeNull()
  })
})
