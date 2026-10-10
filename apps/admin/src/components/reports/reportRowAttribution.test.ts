import { describe, expect, it } from 'vitest'
import { captureMode, reporterWho, routePathname } from './reportRowAttribution'
import type { ReportRow } from './types'

const row = (reporter_token_hash: string | null) => ({ reporter_token_hash }) as unknown as ReportRow

describe('reports a Mushi job filed itself', () => {
  // A library-modernizer notice read "user · anon·cron:l" in the reports list (2026-10-09).
  it('reads as the job, not as a user', () => {
    const r = row('cron:library-modernizer')
    expect(captureMode(null, r).label).toBe('mushi')
    expect(captureMode(null, r).tooltip).toContain('dependency check (library-modernizer)')
    expect(reporterWho(r).label).toBe('dependency check')
  })

  it('names an unknown job by its id', () => {
    expect(reporterWho(row('cron:new-job')).label).toBe('new-job')
  })

  // 22 Sentry reports read "user · User opened the widget" (2026-10-09).
  it('labels a Sentry report as sentry, not a widget user', () => {
    const r = { reporter_token_hash: 'rk1_abc', source: 'sentry' } as unknown as ReportRow
    expect(captureMode(null, r).label).toBe('sentry')
  })

  it('leaves people and SDK reports alone', () => {
    const r = row('rk1_abcdef0123456789')
    expect(captureMode(null, r).label).toBe('user')
    expect(captureMode('captureException', r).label).toBe('server')
    expect(reporterWho(r).label.startsWith('anon·')).toBe(true)
  })
})

describe('routePathname', () => {
  it('drops origin, query and fragment so URL-embedded PII never reaches a chip or link', () => {
    expect(routePathname('https://app.example.com/checkout?email=a@b.co#step2')).toBe('/checkout')
    expect(routePathname('/settings?token=abc')).toBe('/settings')
    expect(routePathname('/orders#latest')).toBe('/orders')
  })

  it('returns null for nothing', () => {
    expect(routePathname(undefined)).toBeNull()
    expect(routePathname('?q=1')).toBeNull()
  })
})
