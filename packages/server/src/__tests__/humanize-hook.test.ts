/**
 * The server copy of the pre-push advice. A lefthook mention that is not a
 * failed push must not become "nothing was pushed", and a dotted check name
 * must survive the summary's period.
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

  it('keeps dots inside check names', () => {
    const h = humanizeFixError('git push failed: hook steps failed: test.unit, mobile-test. test.unit: FAIL a.test.ts')
    expect(h?.title).toBe("Your repo's own checks failed at push.")
    expect(h?.hint).toContain('Failed checks: test.unit, mobile-test.')
    expect(h?.hint).toContain('Fix test.unit, mobile-test')
  })
})
