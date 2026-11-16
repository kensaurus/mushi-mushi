/**
 * FILE: packages/server/src/__tests__/qa-story-schedule-gate.test.ts
 * PURPOSE: Scheduled QA runs execute only approval_status = 'approved'.
 *
 * The cron query used to select every enabled story, so a pending_review
 * or rejected story with enabled still true was executed on its schedule.
 * Manual runs stay outside that gate.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const runnerSrc = readFileSync(
  resolve(__dirname, '../../supabase/functions/qa-story-runner/index.ts'),
  'utf8',
)

describe('isApprovedForSchedule', () => {
  it('runs approved stories and skips pending, rejected, and missing status', async () => {
    const { isApprovedForSchedule } = await import(
      '../../supabase/functions/qa-story-runner/cron-tick.ts'
    )
    expect(isApprovedForSchedule({ approval_status: 'approved' })).toBe(true)
    expect(isApprovedForSchedule({ approval_status: 'pending_review' })).toBe(false)
    expect(isApprovedForSchedule({ approval_status: 'rejected' })).toBe(false)
    expect(isApprovedForSchedule({ approval_status: null })).toBe(false)
    expect(isApprovedForSchedule({})).toBe(false)
  })
})

describe('qa-story-runner cron selection', () => {
  it('loads only enabled approved stories and checks approval again when picking due ones', () => {
    const queryAt = runnerSrc.indexOf(".eq('enabled', true)")
    expect(queryAt).toBeGreaterThan(0)
    const query = runnerSrc.slice(queryAt, queryAt + 120)
    expect(query).toContain(".eq('approval_status', 'approved')")

    const due = runnerSrc.slice(
      runnerSrc.indexOf('const matchAt'),
      runnerSrc.indexOf('if (dueStories.length === 0)'),
    )
    expect(due).toContain('isApprovedForSchedule(s)')
    expect(due).toContain('isEdgeSchedulable(s)')
    expect(due).toContain('selectDueStories(')
    expect(due).toContain('matchAt')
  })

  it('leaves a manual run outside the approval gate', () => {
    const manual = runnerSrc.slice(
      runnerSrc.indexOf('async function executeManualRun'),
      runnerSrc.indexOf('// ── Main handler'),
    )
    expect(manual).not.toContain('approval_status')
    expect(manual).not.toContain('isApprovedForSchedule')
  })
})
