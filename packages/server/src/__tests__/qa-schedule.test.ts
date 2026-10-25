/**
 * FILE: qa-schedule.test.ts
 * PURPOSE: Scheduled QA ticks ignore local stories, defer stories past
 *          the per-project cap, and only catch up a slot inside the last hour.
 */
import { describe, expect, it } from 'vitest'
import { indexLastRuns, selectScheduledStories, type QaScheduleStory } from '../../supabase/functions/_shared/qa-schedule.ts'

const HOUR = '0 * * * *'

function story(partial: Partial<QaScheduleStory> & Pick<QaScheduleStory, 'id'>): QaScheduleStory {
  return {
    project_id: 'p',
    browser_provider: 'firecrawl_actions',
    schedule_cron: HOUR,
    last_run_at: '2026-10-24T11:00:00.000Z',
    ...partial,
  }
}

describe('selectScheduledStories', () => {
  const noon = new Date('2026-10-24T12:00:30.000Z')

  it('does not schedule local stories', () => {
    const decision = selectScheduledStories([
      story({ id: 'local-1', browser_provider: 'local' }),
      story({ id: 'local-2', browser_provider: 'local' }),
      story({ id: 'local-3', browser_provider: 'local' }),
      story({ id: 'cloud', browser_provider: 'browserbase' }),
    ], noon)
    expect(decision.run.map((s) => s.id)).toEqual(['cloud'])
    expect(decision.deferred).toEqual([])
  })

  it('defers stories past the cap, oldest last run first, and the next tick runs them', () => {
    const stories = ['s1', 's2', 's3', 's4', 's5'].map((id, i) => story({
      id,
      last_run_at: i === 4 ? null : `2026-10-24T11:0${i}:00.000Z`,
    }))
    const first = selectScheduledStories(stories, noon)
    // s5 never ran, then s1 (11:00), s2 (11:01). s3 and s4 wait.
    expect(first.run.map((s) => s.id)).toEqual(['s5', 's1', 's2'])
    expect(first.deferred.map((s) => s.id)).toEqual(['s3', 's4'])

    const started = new Set(first.run.map((s) => s.id))
    const next = selectScheduledStories(
      stories.map((s) => started.has(s.id) ? { ...s, last_run_at: '2026-10-24T12:00:05.000Z' } : s),
      new Date('2026-10-24T12:01:00.000Z'),
    )
    expect(next.run.map((s) => s.id)).toEqual(['s3', 's4'])
    expect(next.deferred).toEqual([])
  })

  it('caps each project on its own', () => {
    const stories = ['a', 'b'].flatMap((projectId) =>
      [1, 2, 3, 4].map((n) => story({ id: `${projectId}${n}`, project_id: projectId })),
    )
    const decision = selectScheduledStories(stories, noon)
    expect(decision.run.filter((s) => s.project_id === 'a')).toHaveLength(3)
    expect(decision.run.filter((s) => s.project_id === 'b')).toHaveLength(3)
    expect(decision.deferred.map((s) => s.id).sort()).toEqual(['a4', 'b4'])
  })

  it('treats a run in the current slot as already started', () => {
    const decision = selectScheduledStories([
      story({ id: 'ran', last_run_at: '2026-10-24T12:00:01.000Z' }),
      story({ id: 'waiting', last_run_at: '2026-10-24T11:00:00.000Z' }),
    ], noon)
    expect(decision.run.map((s) => s.id)).toEqual(['waiting'])
  })

  it('waits for the first slot at or after the story was created', () => {
    const created = '2026-10-24T12:30:00.000Z'
    const early = selectScheduledStories([
      story({ id: 'new', last_run_at: null, created_at: created }),
    ], new Date('2026-10-24T12:40:00.000Z'))
    expect(early.run).toEqual([])

    const onSlot = selectScheduledStories([
      story({ id: 'new', last_run_at: null, created_at: created }),
    ], new Date('2026-10-24T13:00:30.000Z'))
    expect(onSlot.run.map((s) => s.id)).toEqual(['new'])
  })

  it('catches up a slot from the last hour and drops an older one', () => {
    const daily = story({
      id: 'daily',
      schedule_cron: '0 0 * * *',
      last_run_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
    })
    const inside = selectScheduledStories([daily], new Date('2026-10-24T01:00:30.000Z'))
    expect(inside.run.map((s) => s.id)).toEqual(['daily'])

    const outside = selectScheduledStories([daily], new Date('2026-10-24T01:01:00.000Z'))
    expect(outside.run).toEqual([])
  })
})

describe('indexLastRuns', () => {
  it('keeps the newest start per story', () => {
    const map = indexLastRuns([
      { story_id: 'a', started_at: '2026-10-24T11:00:00.000Z' },
      { story_id: 'a', started_at: '2026-10-24T12:00:00.000Z' },
      { story_id: 'b', started_at: '2026-10-24T10:00:00.000Z' },
    ])
    expect(map.get('a')).toBe('2026-10-24T12:00:00.000Z')
    expect(map.get('b')).toBe('2026-10-24T10:00:00.000Z')
  })
})

