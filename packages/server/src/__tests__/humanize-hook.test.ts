/**
 * The server copy of the pre-push advice. A lefthook mention that is not a
 * failed push must not become "nothing was pushed", a dotted check name must
 * survive the summary's period, and a check that prints "permission denied"
 * must not be read as a remote authentication failure.
 */
import { describe, expect, it } from 'vitest'
import { humanizeFixError } from '../../supabase/functions/_shared/humanize-error.ts'

describe('humanizeFixError pre-push advice', () => {
  it('does not treat a non-push error that mentions lefthook as a failed push', () => {
    expect(humanizeFixError('cursor-agent failed: lefthook config is missing')?.title).not.toBe(
      "Your repo's own checks failed at push.",
    )
    expect(humanizeFixError('LLM 429 while reading lefthook.yml')?.title).toBe(
      'The LLM provider rate-limited this request.',
    )
    expect(humanizeFixError('git commit failed: hook steps failed: lint. lefthook')?.title).not.toBe(
      "Your repo's own checks failed at push.",
    )
  })

  it('keeps dots inside check names and a check that prints permission denied', () => {
    const h = humanizeFixError(
      'git push failed: hook steps failed: test.unit, mobile-test. test.unit: FAIL a.test.ts | Permission denied reading the fixture',
    )
    expect(h?.title).toBe("Your repo's own checks failed at push.")
    expect(h?.hint).toContain('Failed checks: test.unit, mobile-test.')
    expect(h?.hint).toContain('Fix test.unit, mobile-test')
    expect(h?.hint).not.toMatch(/\u001b/)
  })

  it('drops truecolor codes stored as text', () => {
    const h = humanizeFixError(
      'mushi work: git push failed: \\u001b[38;2;56;56;56mhook steps failed: test.\\u001b[0m test: FAIL a.test.ts',
    )
    expect(h?.title).toBe("Your repo's own checks failed at push.")
    expect(h?.hint).not.toContain('\\u001b')
    expect(h?.raw).not.toContain('\\u001b')
  })

  it('leaves a remote authentication failure alone', () => {
    expect(humanizeFixError('git push failed: remote: Permission denied to bot. fatal: Authentication failed')?.title).not.toBe(
      "Your repo's own checks failed at push.",
    )
    expect(humanizeFixError('git push failed: pre-push hook declined / fatal: Authentication failed')?.title).not.toBe(
      "Your repo's own checks failed at push.",
    )
    expect(humanizeFixError('git push failed: pre-push hook declined. permission denied reading the fixture')?.title).toBe(
      "Your repo's own checks failed at push.",
    )
  })
})
