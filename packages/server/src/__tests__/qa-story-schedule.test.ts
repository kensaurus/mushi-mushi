/**
 * FILE: packages/server/src/__tests__/qa-story-schedule.test.ts
 * PURPOSE: A scheduled qa-story tick runs approved stories only.
 *          pending_review must not be picked — those runs spend
 *          Firecrawl/Browserbase credits and notify on failure.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STORY_CRON,
  SCHEDULED_APPROVAL_STATUS,
  selectStoriesForScheduledTick,
} from '../../supabase/functions/qa-story-runner/schedule.ts'

const now = new Date('2026-10-24T00:00:00Z')
const due = () => true

function story(id: string, approval_status: string) {
  return { id, enabled: true, approval_status, schedule_cron: '* * * * *' }
}

describe('selectStoriesForScheduledTick', () => {
  it('picks an approved story and leaves a pending_review story', () => {
    const picked = selectStoriesForScheduledTick(
      [story('pending', 'pending_review'), story('ok', 'approved')],
      now,
      due,
    )
    expect(picked.map((s) => s.id)).toEqual(['ok'])
  })

  it('leaves a rejected story even when its cron is due', () => {
    expect(selectStoriesForScheduledTick([story('no', 'rejected')], now, due)).toEqual([])
  })

  it('leaves an approved story whose cron is not due', () => {
    expect(selectStoriesForScheduledTick([story('ok', 'approved')], now, () => false)).toEqual([])
  })

  it('keeps the previous default cron when a story has none', () => {
    const seen: string[] = []
    selectStoriesForScheduledTick(
      [{ id: 'bare', approval_status: 'approved', schedule_cron: null }],
      now,
      (expression) => {
        seen.push(expression)
        return true
      },
    )
    expect(seen).toEqual([DEFAULT_STORY_CRON])
    expect(DEFAULT_STORY_CRON).toBe('*/15 * * * *')
  })

  it('treats a missing approval_status as not approved', () => {
    const picked = selectStoriesForScheduledTick(
      [{ id: 'legacy', enabled: true, schedule_cron: '* * * * *' }],
      now,
      due,
    )
    expect(picked).toEqual([])
  })
})

describe('qa-story-runner wiring', () => {
  const src = readFileSync(
    resolve(__dirname, '../../supabase/functions/qa-story-runner/index.ts'),
    'utf8',
  )

  it('the scheduled fetch requires approved, and the tick uses the selector', () => {
    const cron = src.indexOf("startCronRun(db, 'qa-story-runner'")
    expect(cron).toBeGreaterThan(0)
    const fetch = src.indexOf(".from('qa_stories')", cron)
    const block = src.slice(fetch, src.indexOf('if (storiesErr)', fetch))
    expect(block).toContain(".eq('enabled', true)")
    expect(block).toContain(".eq('approval_status', SCHEDULED_APPROVAL_STATUS)")
    expect(SCHEDULED_APPROVAL_STATUS).toBe('approved')
    expect(src.slice(cron)).toContain('selectStoriesForScheduledTick(')
  })

  it('manual runs do not apply the scheduled approval gate', () => {
    const start = src.indexOf('async function executeManualRun')
    const end = src.indexOf('// ── Main handler')
    const manual = src.slice(start, end)
    expect(manual).not.toContain('selectStoriesForScheduledTick')
    expect(manual).not.toContain('SCHEDULED_APPROVAL_STATUS')
    expect(manual).not.toContain("eq('approval_status'")
  })
})
