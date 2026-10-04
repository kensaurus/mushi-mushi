/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/fixes/FixRecommendation.test.tsx
 * PURPOSE: The /fixes recommendation counts reports, not attempts, and its
 *          advice comes from the real causes.
 *
 * Why (glot.it 2026-10-04): it read "8 recent fix attempts failed" with a
 * fixed list of guesses (brittle prompt, GitHub credentials, unsupported
 * category) over 4 reports already fixed by merged PRs.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FixRecommendation } from './FixRecommendation'
import type { FixAttempt } from './types'

function fix(overrides: Partial<FixAttempt>): FixAttempt {
  return { id: 'f', report_id: 'r', agent: 'claude_code', status: 'failed', started_at: '2026-10-03T09:00:00Z', ...overrides }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(fixes: FixAttempt[]): string {
  act(() => root.render(createElement(FixRecommendation, { fixes, dispatches: [] })))
  return host.textContent ?? ''
}

describe('FixRecommendation', () => {
  it('stays silent when every failed attempt belongs to a report a merged PR fixed', () => {
    const superseded = Array.from({ length: 8 }, (_, i) =>
      fix({ id: `f${i}`, report_id: `r${i % 4}`, report_fix_state: 'resolved', report_fixed_by_pr: 140, is_latest_attempt: false }),
    )
    expect(render(superseded)).toBe('')
  })

  it('counts reports and names their real cause and fix', () => {
    const text = render([
      fix({
        id: 'a',
        report_id: 'audio',
        status: 'skipped_no_context',
        error: 'Embedding API error: 401 from api.openai.com',
        report_fix_state: 'failed',
        is_latest_attempt: true,
        credential_block: { provider: 'openai', keyHealthy: false },
      }),
      fix({
        id: 'b',
        report_id: 'lcp',
        error: 'review_failed: the fix model flagged its own change for human review.',
        report_fix_state: 'failed',
        is_latest_attempt: true,
        retryable: true,
      }),
      fix({ id: 'c', report_id: 'lcp', report_fix_state: 'failed', is_latest_attempt: false }),
    ])
    expect(text).toContain('Auto-fix stopped on 2 reports')
    expect(text).toContain('OpenAI rejected the key. Replace it, then retry.')
    expect(text).toContain('Agent unsure of its patch')
    expect(text).not.toContain('brittle agent prompt')
  })

  it('counts one open PR per report', () => {
    const text = render([
      fix({ id: 'p1', report_id: 'r1', status: 'completed', pr_url: 'https://github.com/a/b/pull/3', pr_state: 'open', report_fix_state: 'pr_open' }),
      fix({ id: 'p0', report_id: 'r1', status: 'completed', pr_url: 'https://github.com/a/b/pull/2', pr_state: 'closed', report_fix_state: 'pr_open' }),
    ])
    expect(text).toContain('1 PR is ready for review')
  })
})
