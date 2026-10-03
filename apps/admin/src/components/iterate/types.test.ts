import { describe, expect, it } from 'vitest'
import { MODEL_OPTIONS, PDCA_DEFAULT_MODEL } from './types'

describe('PDCA model options', () => {
  it('defaults to Sonnet 5.5 and offers the current Claude models only', () => {
    expect(PDCA_DEFAULT_MODEL).toBe('claude-sonnet-5-5')
    const values = MODEL_OPTIONS.map((m) => m.value)
    expect(values[0]).toBe(PDCA_DEFAULT_MODEL)
    expect(values).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5'])
    for (const v of values) expect(v.startsWith('claude-')).toBe(true)
  })
})
