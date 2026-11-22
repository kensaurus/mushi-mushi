import { describe, expect, it } from 'vitest'
import { humanizeFixError } from './humanizeFixError'

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
    expect(h?.title).toBe('Mushi Mushi found no code change to make from this report.')
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
      'Mushi Mushi sent Cursor a field it no longer accepts.',
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

// Report 3a5cb64c (2026-11-20): the story printed this whole Node stack as the step's headline.
describe('humanizeFixError: the local worker could not commit', () => {
  const raw =
    "mushi work: git commit failed: […] at wrapModuleLoad (node:internal/modules/cjs/loader:261:19) / at typescript (file:///C:/x/scripts/viz-token-emit.mjs:28:21) / { / code: 'MODULE_NOT_FOUND', / } / Node.js v26.13.1"

  it('says a pre-commit check failed on a missing dependency, in one plain line', () => {
    const h = humanizeFixError(raw)
    expect(h?.title).toBe("The local worker couldn't commit: a pre-commit check failed (missing dependency).")
    expect(h?.title).not.toMatch(/node:internal|MODULE_NOT_FOUND/)
    expect(h?.raw).toBe(raw)
    expect(h?.known).toBeUndefined()
  })

  it('says a pre-commit check failed when the cause is something else', () => {
    expect(humanizeFixError('mushi work: git commit failed: lint-staged exited with code 1')?.title).toBe(
      "The local worker couldn't commit: a pre-commit check failed.",
    )
  })

  it('names a refused push separately', () => {
    expect(humanizeFixError('mushi work: git push failed: remote: Permission denied')?.title).toBe("The local worker couldn't push the fix branch.")
  })
})
