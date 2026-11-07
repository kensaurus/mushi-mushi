import { describe, expect, it } from 'vitest'
import { humanizeFixError } from './humanizeFixError'

describe('humanizeFixError: pre-push hook', () => {
  it('names the checks and drops colour codes, even when a check prints permission denied', () => {
    const raw = [
      'mushi work: git push failed: \\u001b[38;2;56;56;56m',
      'Your repo\'s own checks failed at push. The fix is committed on bugfix/saved (abc1234def); nothing was pushed.',
      'Failed checks: test.unit, mobile-test. Worker checkout: /tmp/mushi-wt/checkout | Hook output: hook steps failed: test.unit, mobile-test. test.unit: FAIL a.test.ts | Permission denied reading the fixture',
    ].join(' ')
    const h = humanizeFixError(raw)
    expect(h?.title).toBe("Your repo's own checks failed at push.")
    expect(h?.hint).toContain('Failed checks: test.unit, mobile-test.')
    expect(h?.hint).toContain('git -C /tmp/mushi-wt/checkout push -u origin bugfix/saved')
    expect(h?.hint).toContain('Permission denied reading the fixture')
    expect(h?.hint).not.toContain('\\u001b')
    expect(h?.raw).not.toMatch(/\u001b/)
  })

  it('does not treat a non-push error that mentions lefthook as a failed push', () => {
    expect(humanizeFixError('cursor-agent failed: lefthook config is missing')?.title).not.toBe(
      "Your repo's own checks failed at push.",
    )
    expect(humanizeFixError('git commit failed: hook steps failed: lint. lefthook')?.title).not.toBe(
      "Your repo's own checks failed at push.",
    )
  })
})

describe('humanizeFixError: no relevant code', () => {
  it('points at the web search setting when the fix worker says it is off', () => {
    const h = humanizeFixError(
      'No code context. Turning on "Search the web for known fixes" in Settings → Web tools can help: the agent then also reads how others fixed this error.',
      { category: 'no_relevant_code' },
    )
    expect(h?.hint).toContain('Web search is off')
    expect(h?.action).toEqual({
      label: 'Turn on web search',
      target: { kind: 'route', to: '/settings?tab=tools', hash: 'known-issues-search' },
    })
  })

  it('keeps the re-index advice and Retry otherwise', () => {
    const h = humanizeFixError('No code context.', { category: 'no_relevant_code' })
    expect(h?.hint).toContain('Re-index')
    expect(h?.action?.target).toEqual({ kind: 'retry' })
  })
})

describe('humanizeFixError: review gate', () => {
  // Real error from a 2026-10-16 dispatch on a Sentry web-vital report.
  const COMMENTS_ONLY =
    "review_failed: the proposed change only adds or removes comments, which is not a fix. The report is a Sentry 'Poor FCP' event of 8312ms on /chat with no reproduction steps."

  it('says there was nothing to change, and offers no retry', () => {
    const h = humanizeFixError(COMMENTS_ONLY)
    expect(h?.title).toBe('Mushi found no code change to make from this report.')
    expect(h?.hint).toContain('fix prompt')
    expect(h?.action).toBeUndefined()
    expect(h?.severity).toBe('hard')
  })

  it('keeps Retry for a patch the agent was unsure of', () => {
    const h = humanizeFixError('review_failed: the patch touches unrelated files')
    expect(h?.title).toBe('The fix agent was not confident in its own patch.')
    expect(h?.action?.target).toEqual({ kind: 'retry' })
  })
})

describe('humanizeFixError: Cursor cannot reach the repo', () => {
  const raw =
    "Cursor API 400 validation_error: Failed to verify existence of branch 'main' in repository kensaurus/yen-yen. Please ensure the branch name is correct."

  it('blames GitHub access, names the repo and offers no retry', () => {
    const h = humanizeFixError(raw)
    expect(h?.title).toBe("Cursor can't see this repository.")
    expect(h?.hint).toContain('kensaurus/yen-yen')
    expect(h?.hint).not.toContain('yen-yen..')
    expect(h?.severity).toBe('hard')
    expect(h?.action?.target).toEqual({ kind: 'external', url: 'https://cursor.com/dashboard?tab=integrations' })
  })

  it('keeps the schema-drift reading for other validation errors', () => {
    expect(humanizeFixError('Cursor API 400 validation_error: Unrecognized key "branchName"')?.title).toBe(
      'Mushi sent Cursor a field it no longer accepts.',
    )
  })
})

describe('humanizeFixError: the agent explained why it opened no PR', () => {
  it('already fixed: no Retry, by category or by the error line', () => {
    const byCat = humanizeFixError('anything', { category: 'already_fixed' })
    const byText = humanizeFixError('Agent found nothing to change: This crash is already fixed on main.')
    for (const h of [byCat, byText]) {
      expect(h?.title).toBe('The agent found nothing to change.')
      expect(h?.severity).toBe('hard')
      expect(h?.action).toBeUndefined()
    }
  })

  it('not actionable and needs a person: no Retry, by category or by the error line', () => {
    const cases: Array<[string, string, string]> = [
      ['not_actionable', 'Agent found nothing it can tie to code: The event has no stack.', 'The agent found nothing it can tie to code.'],
      ['needs_human', 'Agent says this needs a person: BL-175 still needs a product decision.', 'The agent needs a decision from you.'],
    ]
    for (const [category, line, title] of cases) {
      for (const h of [humanizeFixError('anything', { category }), humanizeFixError(line)]) {
        expect(h?.title).toBe(title)
        expect(h?.severity).toBe('hard')
        expect(h?.action).toBeUndefined()
      }
    }
  })

  it('wrong repo: points at the repos page', () => {
    const h = humanizeFixError('Agent says the code is in another repo: The payout check is not in this repository.')
    expect(h?.title).toBe('The fix belongs in another repo.')
    expect(h?.action?.target).toEqual({ kind: 'route', to: '/repo' })
  })
})
