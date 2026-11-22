/**
 * Fix failures from older workers carried git hooks' colour codes, and the
 * console showed them raw ("Secret scan... \u001b[32;1mOK\u001b[0m").
 */
import { describe, expect, it } from 'vitest'
import { stripTerminalCodes } from '../../supabase/functions/_shared/terminal-text.ts'

describe('stripTerminalCodes', () => {
  it('removes colour and cursor sequences from hook output', () => {
    const raw = 'mushi work: git push failed: Secret scan (commits being pushed)... \u001b[32;1mOK\u001b[0m / \u001b[2K\u001b[1GChecking'
    expect(stripTerminalCodes(raw)).toBe('mushi work: git push failed: Secret scan (commits being pushed)... OK / Checking')
  })

  it('removes OSC sequences such as terminal titles and links', () => {
    expect(stripTerminalCodes('\u001b]0;gitleaks\u0007done \u001b]8;;https://x.test\u0007link\u001b]8;;\u0007')).toBe('done link')
  })

  it('leaves plain text, null and undefined as they are', () => {
    expect(stripTerminalCodes('push rejected: [main] 3 ahead')).toBe('push rejected: [main] 3 ahead')
    expect(stripTerminalCodes(null)).toBeNull()
    expect(stripTerminalCodes(undefined)).toBeUndefined()
  })
})
