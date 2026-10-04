import { describe, expect, it } from 'vitest'
import { distinctEventsLabel, eventCatalogue, mergePeoplePage } from './analyticsLists'

const person = (id: string | null, first = '2026-10-01T00:00:00Z', name: string | null = null) => ({
  end_user_id: id,
  external_user_id: null,
  display_name: name,
  first_seen_at: first,
})

describe('mergePeoplePage (QA 176)', () => {
  it('never shows page 1 twice when it is merged again', () => {
    const page1 = [person('a'), person('b')]
    const page2 = [person('c')]
    const once = mergePeoplePage([], page1)
    const replayed = mergePeoplePage(once, page1)
    expect(mergePeoplePage(replayed, page2).map((p) => p.end_user_id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps distinct anonymous people apart', () => {
    const rows = mergePeoplePage([], [person(null, '2026-10-01T00:00:00Z'), person(null, '2026-10-02T00:00:00Z')])
    expect(rows).toHaveLength(2)
  })
})

describe('event catalogue (QA 290)', () => {
  const top = Array.from({ length: 20 }, (_, i) => ({ name: `event_${i}` }))

  it('offers every event name when the server sends them', () => {
    const names = [...top.map((e) => e.name), 'rare_event']
    expect(eventCatalogue({ top_events: top, event_names: names })).toContain('rare_event')
    expect(distinctEventsLabel({ top_events: top, distinct_events: 21 })).toBe('21')
  })

  it('does not claim exactly 20 from a capped list', () => {
    expect(distinctEventsLabel({ top_events: top })).toBe('20+')
    expect(distinctEventsLabel({ top_events: top.slice(0, 3) })).toBe('3')
    expect(eventCatalogue({ top_events: top })).toHaveLength(20)
  })
})
