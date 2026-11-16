/**
 * FILE: packages/server/src/__tests__/qa-story-schedule.test.ts
 * PURPOSE: Scheduled QA selection skips explicit local stories, keeps a
 *          missing provider, and defers stories past the per-project cap
 *          instead of marking them skipped. The cron gate uses the same
 *          60-minute carry.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DUE_CARRY_MINUTES,
  isEdgeSchedulable,
  selectDueStories,
  storyIsDue,
  type ScheduledStory,
} from '../../supabase/functions/qa-story-runner/schedule.ts'

const AT = new Date('2026-11-17T10:00:00.000Z')

function story(partial: Partial<ScheduledStory> & Pick<ScheduledStory, 'id'>): ScheduledStory {
  return {
    project_id: 'p1',
    schedule_cron: '0 * * * *',
    browser_provider: 'firecrawl_actions',
    last_run_at: null,
    ...partial,
  }
}

describe('isEdgeSchedulable', () => {
  it('drops an explicit local provider and keeps a missing one', () => {
    expect(isEdgeSchedulable({ browser_provider: 'local' })).toBe(false)
    expect(isEdgeSchedulable({ browser_provider: null })).toBe(true)
    expect(isEdgeSchedulable({})).toBe(true)
    expect(isEdgeSchedulable({ browser_provider: 'firecrawl_actions' })).toBe(true)
    expect(isEdgeSchedulable({ browser_provider: 'browserbase' })).toBe(true)
  })
})

describe('selectDueStories', () => {
  it('does not start local stories and still starts a null provider', () => {
    const picked = selectDueStories(
      [
        story({ id: 'local', browser_provider: 'local' }),
        story({ id: 'missing', browser_provider: null }),
        story({ id: 'cloud', browser_provider: 'firecrawl_actions' }),
      ],
      AT,
      3,
      0,
    )
    expect(picked.map((s) => s.id).sort()).toEqual(['cloud', 'missing'])
  })

  it('leaves stories past the cap out, oldest last run first', () => {
    const picked = selectDueStories(
      [
        story({ id: 'c', last_run_at: '2026-11-17T09:00:00.000Z' }),
        story({ id: 'a', last_run_at: null }),
        story({ id: 'd', last_run_at: '2026-11-17T09:30:00.000Z' }),
        story({ id: 'b', last_run_at: '2026-11-17T08:00:00.000Z' }),
      ],
      AT,
      3,
      0,
    )
    expect(picked.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(picked.map((s) => s.id)).not.toContain('d')
  })

  it('caps each project on its own', () => {
    const picked = selectDueStories(
      [
        story({ id: 'a1', project_id: 'a' }),
        story({ id: 'a2', project_id: 'a' }),
        story({ id: 'b1', project_id: 'b' }),
      ],
      AT,
      1,
      0,
    )
    expect(picked.map((s) => s.id).sort()).toEqual(['a1', 'b1'])
  })

  it('keeps an unrun slot due through the carry window, and not after a real run', () => {
    const later = new Date('2026-11-17T10:05:00.000Z')
    expect(storyIsDue('0 * * * *', later, null, DUE_CARRY_MINUTES)).toBe(true)
    expect(storyIsDue('0 * * * *', later, '2026-11-17T09:00:00.000Z', DUE_CARRY_MINUTES)).toBe(true)
    expect(storyIsDue('0 * * * *', later, '2026-11-17T10:00:30.000Z', DUE_CARRY_MINUTES)).toBe(false)
    expect(storyIsDue('0 * * * *', later, null, 0)).toBe(false)
  })
})

describe('qa-story-runner cron gate', () => {
  const sql = readFileSync(
    resolve(__dirname, '../../supabase/migrations/20261117010000_qa_story_runner_defer.sql'),
    'utf8',
  )
  const runner = readFileSync(
    resolve(__dirname, '../../supabase/functions/qa-story-runner/index.ts'),
    'utf8',
  )

  it('uses the same 60-minute carry and does not drop a null provider', () => {
    expect(DUE_CARRY_MINUTES).toBe(60)
    expect(sql).toContain('generate_series(0, 60)')
    expect(sql).toContain("s.browser_provider is distinct from 'local'")
    expect(sql).toContain("r.status <> 'skipped'")
    expect(sql).toContain("s.approval_status = 'approved'")
  })

  it('does not insert a skipped row for the cap or for local stories', () => {
    expect(runner).not.toContain("error_message: 'rate_limited'")
    expect(runner).toContain('isEdgeSchedulable(s)')
    expect(runner).toContain('if (!isEdgeSchedulable(story)) continue')
    expect(runner).toContain("story.browser_provider ?? 'firecrawl_actions'")
  })
})
