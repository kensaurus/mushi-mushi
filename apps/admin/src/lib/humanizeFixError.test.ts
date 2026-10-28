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

describe('humanizeFixError: Anthropic workspace usage cap', () => {
  it('explains the spend cap instead of calling it a malformed request', () => {
    const h = humanizeFixError(
      'Claude quota exceeded: You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.',
    )
    expect(h?.title).toBe('The Anthropic workspace has reached its usage limit.')
    expect(h?.hint).toContain('until the limit resets')
    expect(h?.severity).toBe('soft')
    expect(h?.action?.target).toEqual({ kind: 'route', to: '/settings?tab=byok' })
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
