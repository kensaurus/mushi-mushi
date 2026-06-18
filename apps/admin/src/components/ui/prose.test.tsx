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
    const md = '# Weekly digest\n\nSecond paragraph ignored.'
    expect(excerptFirstParagraph(md)).toBe('Weekly digest')
    const long = 'A'.repeat(400)
    expect(excerptFirstParagraph(long, 380)).toHaveLength(381)
    expect(excerptFirstParagraph(long, 380).endsWith('…')).toBe(true)
  })

  it('excerptFirstParagraph returns empty for blank input', () => {
    expect(excerptFirstParagraph('')).toBe('')
    expect(excerptFirstParagraph(null)).toBe('')
  })
})
