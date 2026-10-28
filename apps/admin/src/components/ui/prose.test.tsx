import { describe, expect, it } from 'vitest'
import {
  excerptFirstParagraph,
  looksLikeMarkdown,
} from './prose'

describe('ProseBlock helpers', () => {
  it('detects markdown signals', () => {
    expect(looksLikeMarkdown('plain sentence only')).toBe(false)
    expect(looksLikeMarkdown('## Heading\n\nBody')).toBe(true)
    expect(looksLikeMarkdown('- bullet one')).toBe(true)
    expect(looksLikeMarkdown('**bold** word')).toBe(true)
  })

  it('excerptFirstParagraph strips headings and caps length', () => {
    // A title on its own is not an excerpt: Weekly insights showed only
    // "Mushi Mushi Weekly Bug Digest" (2026-10-28).
    const md = '# Weekly digest\n\nFirst real paragraph.\n\nThird paragraph ignored.'
    expect(excerptFirstParagraph(md)).toBe('First real paragraph.')
    expect(excerptFirstParagraph('## Fix\nBody under the heading.')).toBe('Fix\nBody under the heading.')
    expect(excerptFirstParagraph('# Only a title')).toBe('Only a title')
    // The real digest: title, a label line, a heading, then the summary.
    const digest = '# Mushi Mushi Weekly Bug Digest\n\n**Project:** mushi-mushi | **Week of:** 2026-10-19\n\n## Summary\n\nThis week brought **140 new reports**.'
    expect(excerptFirstParagraph(digest)).toBe('This week brought 140 new reports.')
    const long = 'A'.repeat(400)
    expect(excerptFirstParagraph(long, 380)).toHaveLength(381)
    expect(excerptFirstParagraph(long, 380).endsWith('…')).toBe(true)
  })

  it('excerptFirstParagraph returns empty for blank input', () => {
    expect(excerptFirstParagraph('')).toBe('')
    expect(excerptFirstParagraph(null)).toBe('')
  })
})
