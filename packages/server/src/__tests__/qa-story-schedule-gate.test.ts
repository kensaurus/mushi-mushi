/**
 * FILE: packages/server/src/__tests__/qa-story-schedule-gate.test.ts
 * PURPOSE: Scheduled QA runs execute only approval_status = 'approved'.
 *
 * The cron query used to select every enabled story, so a pending_review
 * or rejected story with enabled still true was executed on its schedule.
 * Local stories are not selected either: the edge runner cannot start them,
 * and each tick was inserting a skipped qa_story_runs row. Manual runs stay
 * outside both gates.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const runnerSrc = readFileSync(
  resolve(__dirname, '../../supabase/functions/qa-story-runner/index.ts'),
  'utf8',
)

describe('cron tick gates', () => {
  it('runs approved edge stories and leaves pending, rejected, and local stories off the cron path', async () => {
    const { isApprovedForSchedule, isEdgeScheduledProvider } = await import(
      '../../supabase/functions/qa-story-runner/cron-tick.ts'
    )
    expect(isApprovedForSchedule({ approval_status: 'approved' })).toBe(true)
    expect(isApprovedForSchedule({ approval_status: 'pending_review' })).toBe(false)
    expect(isApprovedForSchedule({ approval_status: 'rejected' })).toBe(false)
    expect(isApprovedForSchedule({ approval_status: null })).toBe(false)
    expect(isApprovedForSchedule({})).toBe(false)

    expect(isEdgeScheduledProvider({ browser_provider: 'local' })).toBe(false)
    expect(isEdgeScheduledProvider({ browser_provider: 'firecrawl_actions' })).toBe(true)
    expect(isEdgeScheduledProvider({ browser_provider: 'browserbase' })).toBe(true)
    expect(isEdgeScheduledProvider({ browser_provider: null })).toBe(true)
    expect(isEdgeScheduledProvider({})).toBe(true)
  })
})

describe('qa-story-runner cron selection', () => {
  it('loads only enabled approved stories and checks approval again when picking due ones', () => {
    const queryAt = runnerSrc.indexOf(".eq('enabled', true)")
    expect(queryAt).toBeGreaterThan(0)
    const query = runnerSrc.slice(queryAt, queryAt + 200)
    expect(query).toContain(".eq('approval_status', 'approved')")
    expect(query).toContain(".neq('browser_provider', 'local')")

    const due = runnerSrc.slice(
      runnerSrc.indexOf('const dueStories'),
      runnerSrc.indexOf('if (dueStories.length === 0)'),
    )
    expect(due).toContain('isApprovedForSchedule(s)')
    expect(due).toContain('isEdgeScheduledProvider(s)')
    expect(due).toContain("cronMatches(s.schedule_cron ?? '*/15 * * * *', matchAt)")
  })

  it('leaves a manual run outside the approval gate', () => {
    const manual = runnerSrc.slice(
      runnerSrc.indexOf('async function executeManualRun'),
      runnerSrc.indexOf('// ── Main handler'),
    )
    expect(manual).not.toContain('approval_status')
    expect(manual).not.toContain('isApprovedForSchedule')
    expect(manual).not.toContain('isEdgeScheduledProvider')
  })
})
