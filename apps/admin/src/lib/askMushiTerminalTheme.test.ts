import { describe, expect, it } from 'vitest'
import { askMushiShikiThemes, formatAssistantMarkdown } from './askMushiTerminalTheme'

describe('askMushiShikiThemes', () => {
  it('uses Monokai on light app theme', () => {
    expect(askMushiShikiThemes('light')).toEqual(['monokai', 'monokai'])
  })

  it('uses light Shiki theme on dark app theme (reverse terminal)', () => {
    expect(askMushiShikiThemes('dark')).toEqual(['one-light-pro', 'one-light-pro'])
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
