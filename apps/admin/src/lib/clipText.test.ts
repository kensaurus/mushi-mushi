import { describe, expect, it } from 'vitest'
import { clipAtWord, reportHeading } from './clipText'

/** The 200-char summary fast-filter stored for report 469f6962, cut mid-word. */
const LEGACY_SUMMARY = `${'word '.repeat(39)}awkward wrapping`.slice(0, 200) // ends "…word awkwa"

describe('clipAtWord', () => {
  it('never splits a word and ends with an ellipsis', () => {
    const out = clipAtWord('one two three four five six seven', 16)
    expect(out).toBe('one two three…')
    expect(out.length).toBeLessThanOrEqual(16)
  })

  it('leaves short text alone', () => {
    expect(clipAtWord('short', 200)).toBe('short')
  })
})

describe('reportHeading', () => {
  it('prefers the Stage-2 title untouched', () => {
    expect(reportHeading({ title: 'Footer links run together', summary: LEGACY_SUMMARY })).toEqual({
      text: 'Footer links run together',
      full: 'Footer links run together',
      truncated: false,
    })
  })

  it('re-clips a legacy 200-char summary on a word and offers the description as full text', () => {
    expect(LEGACY_SUMMARY).toHaveLength(200)
    const h = reportHeading({ summary: LEGACY_SUMMARY, description: 'The full reporter description.' })
    expect(h.truncated).toBe(true)
    expect(h.text.endsWith('…')).toBe(true)
    expect(h.text).not.toMatch(/awkwa/)
    expect(h.text).toMatch(/word…$/)
    expect(h.full).toBe('The full reporter description.')
  })

  it('keeps a complete summary as-is', () => {
    expect(reportHeading({ summary: 'Button overlaps footer.' }).truncated).toBe(false)
  })

  it('clips a long description fallback and keeps the full text', () => {
    const description = 'word '.repeat(80).trim()
    const h = reportHeading({ description })
    expect(h.truncated).toBe(true)
    expect(h.text.length).toBeLessThanOrEqual(200)
    expect(h.full).toBe(description)
  })

  it('falls back to "Untitled report"', () => {
    expect(reportHeading({}).text).toBe('Untitled report')
  })
})
