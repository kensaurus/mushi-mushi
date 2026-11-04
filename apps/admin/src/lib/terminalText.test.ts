import { describe, expect, it } from 'vitest'
import {
  failedHookChecks,
  pushHookAdvice,
  pushRecoveryCommand,
  stripTerminalCodes,
} from './terminalText'

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
      `${GRAY}┃ 🥊 test (22.29 seconds)${RESET}`,
    ].join('\n')
    const advice = pushHookAdvice(raw)
    expect(advice?.title).toBe("Your repo's own checks failed at push.")
    expect(advice?.checks).toEqual(['test'])
    expect(advice?.hint).toContain('Failed checks: test.')
    expect(advice?.hint).toContain('FAIL lib/queries.test.ts')
    expect(advice?.hint).not.toMatch(/\u001b/)
    expect(advice?.command).toBeNull()
    expect(advice?.hint).toContain('worker checkout')
    expect(failedHookChecks(raw)).toEqual(['test'])
  })

  it('reads the summary mushi work already parsed, including a check that prints permission denied', () => {
    const raw = 'git push failed: hook steps failed: test, knip. test: FAIL a.test.ts | Permission denied reading the fixture | Authentication failed for the test user'
    const advice = pushHookAdvice(raw)
    expect(advice?.checks).toEqual(['test', 'knip'])
    expect(advice?.hint).toContain('Failed checks: test, knip.')
  })

  it('keeps dots that are part of a check name', () => {
    const raw = 'git push failed: hook steps failed: test.unit, mobile-test. test.unit: FAIL a.test.ts'
    expect(failedHookChecks(raw)).toEqual(['test.unit', 'mobile-test'])
    expect(pushHookAdvice(raw)?.checks).toEqual(['test.unit', 'mobile-test'])
    expect(pushHookAdvice(raw)?.hint).toContain('Fix test.unit, mobile-test')
  })

  it('builds a push that targets the worker checkout from any directory', () => {
    const checkout = '/tmp/mushi-wt/checkout'
    const raw = `mushi work: git push failed: Your repo's own checks failed at push. The fix is committed on bugfix/saved (abc1234def); nothing was pushed. Failed checks: test. Worker checkout: ${checkout} | Hook output: hook steps failed: test. test: FAIL a.test.ts`
    const advice = pushHookAdvice(raw)
    expect(advice?.command).toBe(`git -C ${checkout} push -u origin bugfix/saved`)
    expect(advice?.hint.indexOf(checkout)).toBeLessThan(advice!.hint.indexOf('git -C'))
    expect(advice?.hint).toContain('from any directory')
    expect(advice?.hint).toContain('FAIL a.test.ts')
  })

  it('does not treat a non-push error that mentions lefthook as a failed push', () => {
    expect(pushHookAdvice('cursor-agent failed: lefthook config is missing')).toBeNull()
    expect(pushHookAdvice('git commit failed: hook steps failed: lint. lefthook')).toBeNull()
    expect(pushHookAdvice('The report mentions a pre-push hook and 🥊')).toBeNull()
  })

  it('leaves a remote rejection alone', () => {
    expect(pushHookAdvice('git push failed: ! [rejected] HEAD -> main (non-fast-forward)')).toBeNull()
    expect(pushHookAdvice('git push failed: remote: Permission denied to bot. fatal: Authentication failed')).toBeNull()
    expect(pushHookAdvice('git push failed: pre-push hook declined / fatal: Authentication failed for https://github.com/o/r.git')).toBeNull()
    expect(pushHookAdvice('git push failed: pre-push hook declined. fatal: Authentication failed')).toBeNull()
    expect(pushHookAdvice('git push failed: pre-push hook declined. permission denied reading the fixture')?.checks).toEqual([])
    expect(pushHookAdvice('git push failed: pre-push hook declined. permission denied reading the fixture')?.title).toBe(
      "Your repo's own checks failed at push.",
    )
  })
})

describe('pushRecoveryCommand', () => {
  it('names the worker checkout and the saved branch', () => {
    expect(pushRecoveryCommand('/tmp/mushi-wt/checkout', 'bugfix/MUSHI-1-local-cursor')).toBe(
      'git -C /tmp/mushi-wt/checkout push -u origin bugfix/MUSHI-1-local-cursor',
    )
  })

  it('does not take a checkout path that contains a space', () => {
    expect(pushHookAdvice('git push failed: hook steps failed: test. The fix is committed on bugfix/saved (abc1234def); nothing was pushed. Worker checkout: /home/My User/.cache/wt | Hook output: hook steps failed: test.')?.command).toBeNull()
  })

  it('refuses a branch or path that is not safe to put in a command', () => {
    expect(pushRecoveryCommand('/tmp/mushi-wt/checkout', 'bugfix/not a branch')).toBeNull()
    expect(pushRecoveryCommand('/tmp/mushi-wt/checkout', '--force')).toBeNull()
    expect(pushRecoveryCommand('/tmp/not a path', 'bugfix/saved')).toBeNull()
  })
})
