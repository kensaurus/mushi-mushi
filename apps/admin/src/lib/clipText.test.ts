import { describe, expect, it } from 'vitest'
import { reportHeading } from './clipText'

/** The 200-char summary fast-filter stored for report 469f6962, cut mid-word. */
const LEGACY_SUMMARY = `${'word '.repeat(39)}awkward wrapping`.slice(0, 200) // ends "…word awkwa"

describe('reportHeading', () => {
  it('clips a long description on a word, never mid-word', () => {
    const description = `${'alpha '.repeat(40)}omega`
    const h = reportHeading({ description })
    expect(h.text.length).toBeLessThanOrEqual(200)
    expect(h.text).toMatch(/alpha…$/)
  })

  it('leaves a short description alone', () => {
    expect(reportHeading({ description: 'short' })).toEqual({ text: 'short', full: 'short', truncated: false })
  })

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

  it('treats a server-clipped summary ("…") as truncated and offers the description', () => {
    const h = reportHeading({ summary: 'Footer links run together…', description: 'Footer links run together on mobile.' })
    expect(h).toEqual({
      text: 'Footer links run together…',
      full: 'Footer links run together on mobile.',
      truncated: true,
    })
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
