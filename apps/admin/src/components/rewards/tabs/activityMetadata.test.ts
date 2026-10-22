import { describe, expect, it } from 'vitest'
import { metadataPairs } from './activityMetadata'

describe('metadata key labels', () => {
  it('turns snake, kebab and camel case into words', () => {
    const labels = metadataPairs({ minutes_today: 1, 'page-url': 'x', reportId: 2, '  streak__days ': 3 }).map((p) => p.label)
    expect(labels).toEqual(['minutes today', 'page url', 'report id', 'streak days'])
  })
})

describe('metadataPairs', () => {
  it('renders the feed example as key: value, not JSON', () => {
    expect(metadataPairs({ minutes_today: 6 })).toEqual([
      { key: 'minutes_today', label: 'minutes today', value: '6' },
    ])
  })

  it('formats scalars, arrays, nulls and nested objects', () => {
    expect(metadataPairs({ ok: true, tags: ['a', 'b'], gone: null, deep: { x: 1 } })).toEqual([
      { key: 'ok', label: 'ok', value: 'true' },
      { key: 'tags', label: 'tags', value: 'a, b' },
      { key: 'gone', label: 'gone', value: '—' },
      { key: 'deep', label: 'deep', value: '{"x":1}' },
    ])
  })

  it('is empty without metadata', () => {
    expect(metadataPairs(null)).toEqual([])
    expect(metadataPairs(undefined)).toEqual([])
    expect(metadataPairs({})).toEqual([])
  })
})
