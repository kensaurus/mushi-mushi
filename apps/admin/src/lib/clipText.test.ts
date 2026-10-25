import { describe, expect, it } from 'vitest'
import { reportHeading, summaryIsHeading } from './clipText'

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

describe('summaryIsHeading', () => {
  it('is true without a Stage-2 title — the heading is the summary itself', () => {
    expect(summaryIsHeading({ summary: 'Button overlaps footer.' })).toBe(true)
    expect(summaryIsHeading({ summary: 'Button overlaps footer.', title: '  ' })).toBe(true)
  })

  it('is true when the title only echoes the summary', () => {
    expect(summaryIsHeading({ title: 'Button overlaps footer.', summary: 'button  overlaps footer.' })).toBe(true)
  })

  it('is false when the title adds a different headline', () => {
    expect(summaryIsHeading({ title: 'Footer links run together', summary: 'Button overlaps footer.' })).toBe(false)
  })

  it('is false with no summary to repeat', () => {
    expect(summaryIsHeading({ title: 'Footer links run together' })).toBe(false)
    expect(summaryIsHeading({})).toBe(false)
  })

  it('is false when the heading re-clips a legacy summary and expands to the description', () => {
    // reportHeading renders a shorter re-clip and "Show full" shows the
    // description, so the summary reads in full nowhere but the callout.
    const h = reportHeading({ summary: LEGACY_SUMMARY, description: 'The checkout button does nothing on mobile Safari.' })
    expect(h.text).not.toBe(LEGACY_SUMMARY)
    expect(h.full).toBe('The checkout button does nothing on mobile Safari.')
    expect(
      summaryIsHeading({ summary: LEGACY_SUMMARY, description: 'The checkout button does nothing on mobile Safari.' }),
    ).toBe(false)
  })

  it('is true when a legacy summary is its own full text (no description)', () => {
    expect(summaryIsHeading({ summary: LEGACY_SUMMARY })).toBe(true)
  })

  it('is true when the heading renders a server-clipped summary verbatim', () => {
    expect(
      summaryIsHeading({ summary: 'Footer links run together…', description: 'Footer links run together on mobile.' }),
    ).toBe(true)
  })
})
