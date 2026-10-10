import { describe, expect, it } from 'vitest'
import { commentTimelineTitle, timelineIso } from '../../supabase/functions/_shared/unified-timeline.ts'
import { sentryEventTimeMs } from '../../supabase/functions/_shared/sentry-ingest.ts'

describe('timelineIso', () => {
  const fallback = '2026-10-03T09:00:00.000Z'
  it('converts epoch ms and ISO strings', () => {
    expect(timelineIso(Date.UTC(2026, 8, 24, 5, 4), fallback)).toBe('2026-09-24T05:04:00.000Z')
    expect(timelineIso('2026-09-24T05:04:00Z', fallback)).toBe('2026-09-24T05:04:00.000Z')
  })
  it('falls back to the report time instead of throwing on a missing or bad timestamp', () => {
    expect(timelineIso(undefined, fallback)).toBe(fallback)
    expect(timelineIso(null, fallback)).toBe(fallback)
    expect(timelineIso('not a date', fallback)).toBe(fallback)
    expect(timelineIso(Number.NaN, fallback)).toBe(fallback)
  })
})

describe('sentryEventTimeMs', () => {
  it('prefers the event datetime, then the epoch-seconds timestamp, then the issue firstSeen', () => {
    expect(sentryEventTimeMs({ datetime: '2026-09-24T05:04:19Z' }, null)).toBe(Date.parse('2026-09-24T05:04:19Z'))
    expect(sentryEventTimeMs({ timestamp: 1790226259 }, null)).toBe(1790226259000)
    expect(sentryEventTimeMs({}, { firstSeen: '2026-09-28T01:00:00Z' })).toBe(Date.parse('2026-09-28T01:00:00Z'))
  })
})

describe('commentTimelineTitle', () => {
  it('calls an internal team note a note, not a reply', () => {
    expect(commentTimelineTitle({ author_kind: 'admin', visible_to_reporter: false })).toBe('Team note')
    expect(commentTimelineTitle({ author_kind: 'admin', visible_to_reporter: true })).toBe('Team reply')
    expect(commentTimelineTitle({ author_kind: 'reporter', visible_to_reporter: true })).toBe('Reporter reply')
  })
})

describe('buildUnifiedReportTimeline ids', () => {
  it('keeps breadcrumb and console ids unique when entries share a millisecond', async () => {
    const { buildUnifiedReportTimeline } = await import('../../supabase/functions/_shared/unified-timeline.ts')
    const { makeFakeDb } = await import('./__stubs__/fake-supabase.ts')
    const ts = Date.UTC(2026, 9, 1)
    const db = makeFakeDb({
      reports: [{
        id: 'r1', project_id: 'p1', status: 'new', description: 'd', category: 'bug', created_at: '2026-10-01T00:00:00Z',
        breadcrumbs: [
          { timestamp: ts, category: 'ui.click', level: 'info', message: 'a' },
          { timestamp: ts, category: 'ui.click', level: 'info', message: 'b' },
        ],
        console_logs: [
          { timestamp: ts, level: 'error', message: 'x' },
          { timestamp: ts, level: 'error', message: 'y' },
        ],
        custom_metadata: null, sentry_trace_id: null,
      }],
    })
    const entries = await buildUnifiedReportTimeline(db as never, 'p1', 'r1')
    const ids = entries.filter((e) => e.lane === 'breadcrumb' || e.lane === 'console').map((e) => e.id)
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
  })
})
