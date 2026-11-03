import { describe, expect, it } from 'vitest'
import { failedHookChecks, pushHookAdvice, pushRecoveryCommand, stripTerminalCodes } from './terminalText'

const GRAY = '\u001b[38;2;56;56;56m'
const RESET = '\u001b[0m'

describe('stripTerminalCodes', () => {
  it('removes truecolor SGR sequences lefthook prints on its borders', () => {
    const raw = `${GRAY}┃ lint failed${RESET}`
    expect(stripTerminalCodes(raw)).toBe('┃ lint failed')
    expect(stripTerminalCodes(raw)).not.toMatch(/\u001b/)
  })

  it('removes the same sequence when it was stored as the characters \\u001b', () => {
    const literal = '\\u001b[38;2;56;56;56m┃ lint failed\\u001b[0m'
    expect(stripTerminalCodes(literal)).toBe('┃ lint failed')
    expect(stripTerminalCodes(literal)).not.toContain('\\u001b')
  })
})

describe('pushHookAdvice', () => {
  it('names the failed lefthook steps and does not keep the colour codes', () => {
    const raw = [
      'mushi work: git push failed: ',
      `${GRAY}┃  test ❯ ${RESET}`,
      ' FAIL  lib/queries.test.ts',
      `${GRAY}🥊 test (22.29 seconds)${RESET}`,
    ].join('\n')
    const advice = pushHookAdvice(raw)
    expect(advice?.title).toBe("Your repo's own checks failed at push.")
    expect(advice?.checks).toEqual(['test'])
    expect(advice?.hint).toContain('Failed checks: test.')
    expect(advice?.hint).not.toMatch(/\u001b/)
    expect(failedHookChecks(raw)).toEqual(['test'])
  })

  it('reads the summary mushi work already parsed', () => {
    const advice = pushHookAdvice('git push failed: hook steps failed: test, knip. test: FAIL a.test.ts')
    expect(advice?.checks).toEqual(['test', 'knip'])
  })

  it('keeps dots that are part of a check name', () => {
    const raw = 'git push failed: hook steps failed: test.unit, mobile-test. test.unit: FAIL a.test.ts'
    expect(failedHookChecks(raw)).toEqual(['test.unit', 'mobile-test'])
    expect(pushHookAdvice(raw)?.checks).toEqual(['test.unit', 'mobile-test'])
    expect(pushHookAdvice(raw)?.hint).toContain('Fix test.unit, mobile-test')
  })

  it('does not treat a non-push error that mentions lefthook as a failed push', () => {
    expect(pushHookAdvice('cursor-agent failed: lefthook config is missing')).toBeNull()
    expect(pushHookAdvice('git commit failed: hook steps failed: lint. lefthook')).toBeNull()
    expect(pushHookAdvice('The report mentions a pre-push hook and 🥊')).toBeNull()
  })

  it('leaves a remote rejection alone', () => {
    expect(pushHookAdvice('git push failed: ! [rejected] HEAD -> main (non-fast-forward)')).toBeNull()
    expect(pushHookAdvice('git push failed: remote: Permission denied. fatal: Authentication failed')).toBeNull()
  })
})

describe('pushRecoveryCommand', () => {
  it('names the saved branch and commit', () => {
    expect(pushRecoveryCommand('bugfix/MUSHI-1-local-cursor', 'abc1234def5678')).toBe(
      'git rev-parse --verify abc1234def5678 && git checkout bugfix/MUSHI-1-local-cursor && git push -u origin bugfix/MUSHI-1-local-cursor',
    )
  })

  it('refuses a branch that is not a plain git ref', () => {
    expect(pushRecoveryCommand('bugfix/$(rm -rf /)', 'abc1234')).toBeNull()
    expect(pushRecoveryCommand('--force', 'abc1234')).toBeNull()
  })
})
