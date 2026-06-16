import { describe, expect, it } from 'vitest'
import { askMushiShikiThemes, formatAssistantMarkdown, formatThreadTitle } from './askMushiTerminalTheme'

describe('askMushiShikiThemes', () => {
  it('uses Monokai on light app theme', () => {
    expect(askMushiShikiThemes('light')).toEqual(['monokai', 'monokai'])
  })

  it('uses light Shiki theme on dark app theme (reverse terminal)', () => {
    expect(askMushiShikiThemes('dark')).toEqual(['one-light', 'one-light'])
  })
})

describe('formatAssistantMarkdown', () => {
  it('unwraps navigate-mode JSON answer payloads', () => {
    const raw = JSON.stringify({ kind: 'answer', text: '## Dashboard\n\nHello' })
    expect(formatAssistantMarkdown(raw)).toBe('## Dashboard\n\nHello')
  })

  it('unwraps fenced JSON blocks', () => {
    const raw = '```json\n{"kind":"answer","text":"Done"}\n```'
    expect(formatAssistantMarkdown(raw)).toBe('Done')
  })

  it('passes through normal markdown', () => {
    expect(formatAssistantMarkdown('## Hello')).toBe('## Hello')
  })
})

describe('formatThreadTitle', () => {
  it('hides legacy resume-thread composer leak titles', () => {
    expect(formatThreadTitle('(resume thread 55cda26e-72c9-4a9b-8ba4-0a59c119a3a7)')).toBe(
      'Previous conversation',
    )
  })

  it('truncates long titles', () => {
    const long = 'a'.repeat(80)
    expect(formatThreadTitle(long).length).toBeLessThanOrEqual(72)
  })
})
