/**
 * FILE: apps/admin/src/lib/statCardLinks.test.ts
 * PURPOSE: Snapshot tiles must open a tab and filter the page really has.
 *
 * Console QA group C (2026-10-04): four /judge tiles linked to `?tab=scores`
 * and `?tab=disagreements`, which JudgePage resolves to Overview (QA 106);
 * the /fixes "Failed" tile opened the unfiltered list (QA 242). The allowed
 * values below mirror resolveJudgeTab / resolveFixesTab / resolveRepoTab and
 * each page's status filter. Add a value here only with the page change.
 */

import { describe, expect, it } from 'vitest'
import { fixesLinks, judgeLinks, repoLinks } from './statCardLinks'

const PAGE_TABS: Record<string, string[]> = {
  '/judge': ['trend', 'evaluations', 'prompts'],
  '/fixes': ['pipeline', 'attempts'],
  '/repo': ['branches', 'activity'],
}

const PAGE_STATUS: Record<string, string[]> = {
  '/fixes': ['failed', 'inflight', 'pr_open', 'merged'],
  '/repo': ['open', 'ci_passing', 'ci_failed', 'failed', 'merged'],
}

function check(link: string) {
  const url = new URL(link, 'https://console.test')
  const tabs = PAGE_TABS[url.pathname]
  if (!tabs) return
  const tab = url.searchParams.get('tab')
  if (tab !== null) expect(tabs, `${link} names tab "${tab}"`).toContain(tab)
  const status = url.searchParams.get('status')
  if (status !== null) expect(PAGE_STATUS[url.pathname] ?? [], `${link} names status "${status}"`).toContain(status)
}

describe('snapshot tile links', () => {
  it('every /judge, /fixes and /repo tile opens a real tab and filter', () => {
    for (const link of [...Object.values(judgeLinks), ...Object.values(fixesLinks), ...Object.values(repoLinks)]) {
      check(link)
    }
  })

  it('the judge Disagreements tile opens the filtered evaluations', () => {
    expect(judgeLinks.disagree).toBe('/judge?tab=evaluations&filter=disagreement')
  })

  it('the fixes Failed tile opens the failed filter', () => {
    expect(new URL(fixesLinks.failed, 'https://c.test').searchParams.get('status')).toBe('failed')
  })
})
