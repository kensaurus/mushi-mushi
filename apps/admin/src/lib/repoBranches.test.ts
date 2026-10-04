/**
 * FILE: apps/admin/src/lib/repoBranches.test.ts
 * PURPOSE: /repo filters match the header chips (console QA 243), the URL
 *          filter is validated (QA 99), and repo errors read as sentences
 *          (QA 20: "[object Object]").
 */

import { describe, expect, it } from 'vitest'
import { branchBucket, countRepoFilters, matchesRepoFilter, repoActionErrorMessage, resolveRepoFilter } from './repoBranches'

describe('repo filters', () => {
  const rows = [
    { bucket: 'merged' as const },
    { bucket: 'ci_failed' as const },
    { bucket: 'ci_passing' as const },
    { bucket: 'open' as const },
    { bucket: 'failed' as const },
    { bucket: 'closed' as const },
  ]

  it('"PR open" counts every open PR, like the header chip', () => {
    expect(countRepoFilters(rows)).toEqual({ all: 6, open: 3, ci_passing: 1, ci_failed: 1, merged: 1, failed: 1 })
    expect(matchesRepoFilter({ bucket: 'ci_failed' }, 'open')).toBe(true)
    expect(matchesRepoFilter({ bucket: 'merged' }, 'open')).toBe(false)
  })

  it('reads a row from an older server with the same rule', () => {
    expect(branchBucket({ pr_url: 'u', merged_at: 'x', check_run_conclusion: 'failure' })).toBe('merged')
    expect(branchBucket({ pr_url: 'u', check_run_conclusion: 'action_required' })).toBe('ci_failed')
    expect(branchBucket({ status: 'failed', pr_url: null })).toBe('failed')
  })

  it('ignores an unknown ?status', () => {
    expect(resolveRepoFilter('ci_failed')).toBe('ci_failed')
    expect(resolveRepoFilter('prs')).toBe('all')
    expect(resolveRepoFilter(null)).toBe('all')
  })
})

describe('repoActionErrorMessage', () => {
  it('uses the server sentence, never an object', () => {
    expect(repoActionErrorMessage('add', { code: 'BAD_REQUEST', message: '"library" is not a repo role.' })).toBe(
      '"library" is not a repo role.',
    )
    expect(repoActionErrorMessage('save', { code: 'DB_ERROR', message: 'duplicate key value violates unique constraint' })).toBe(
      "Couldn't save this repo. Try again in a moment.",
    )
    expect(repoActionErrorMessage('remove', { code: 'FORBIDDEN', message: 'Not a member' })).toBe(
      "You can't remove this repo: ask a project owner or admin.",
    )
    expect(repoActionErrorMessage('add', undefined)).toBe("Couldn't add this repo. Try again in a moment.")
  })
})
