import { describe, expect, it } from 'vitest'
import { captureMode, mushiJobFiler, reporterWho } from './reportRowAttribution'
import type { ReportRow } from './types'

const row = (reporter_token_hash: string | null) => ({ reporter_token_hash }) as unknown as ReportRow

describe('reports a Mushi job filed itself', () => {
  // A library-modernizer notice read "user · anon·cron:l" in the reports list (2026-10-09).
  it('reads as the job, not as a user', () => {
    const r = row('cron:library-modernizer')
    expect(mushiJobFiler(r)).toEqual({ job: 'library-modernizer', label: 'dependency check' })
    expect(captureMode(null, r).label).toBe('mushi')
    expect(reporterWho(r).label).toBe('dependency check')
  })

  it('names an unknown job by its id', () => {
    expect(mushiJobFiler(row('cron:new-job'))?.label).toBe('new-job')
  })

  it('leaves people and SDK reports alone', () => {
    const r = row('rk1_abcdef0123456789')
    expect(mushiJobFiler(r)).toBeNull()
    expect(captureMode(null, r).label).toBe('user')
    expect(captureMode('captureException', r).label).toBe('server')
    expect(reporterWho(r).label.startsWith('anon·')).toBe(true)
  })
})
