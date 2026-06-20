import { describe, it, expect } from 'vitest'
import { setupConsoleCapture } from '../capture/console-capture'

describe('console capture PII scrub', () => {
  it('scrubs secret-like content from captured console messages', () => {
    const capture = setupConsoleCapture(10)
    console.log('contact john@example.com for help')
    const entries = capture.getEntries()
    expect(entries[0]?.message).toContain('[REDACTED_EMAIL]')
    expect(entries[0]?.message).not.toContain('john@example.com')
    capture.restore()
  })
})
