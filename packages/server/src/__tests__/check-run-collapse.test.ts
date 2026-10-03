import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { collapseCheckRuns, installationIdForAttempt, isAdvisoryCheckRun, prNumberFromUrl } from '../../supabase/functions/_shared/github.ts'

describe('collapseCheckRuns', () => {
  it('ignores the Copilot review run when the CI jobs passed', () => {
    expect(collapseCheckRuns([
      { name: 'copilot-pull-request-reviewer', status: 'completed', conclusion: 'failure' },
      { name: 'gate', status: 'completed', conclusion: 'success' },
    ])).toEqual({ status: 'completed', conclusion: 'success' })
  })

  it('does not wait on a pending Copilot review', () => {
    expect(collapseCheckRuns([
      { name: 'copilot-pull-request-reviewer', status: 'in_progress', conclusion: null },
      { name: 'gate', status: 'completed', conclusion: 'success' },
    ])).toEqual({ status: 'completed', conclusion: 'success' })
  })

  it('keeps a real CI failure red', () => {
    expect(collapseCheckRuns([
      { name: 'lint', status: 'completed', conclusion: 'success' },
      { name: 'test', status: 'completed', conclusion: 'failure' },
    ])).toEqual({ status: 'completed', conclusion: 'failure' })
  })

  it('stays pending while any CI job runs', () => {
    expect(collapseCheckRuns([
      { name: 'lint', status: 'completed', conclusion: 'success' },
      { name: 'test', status: 'queued', conclusion: null },
    ])).toEqual({ status: 'in_progress', conclusion: null })
  })

  it('reports nothing when only the review run exists', () => {
    expect(collapseCheckRuns([
      { name: 'copilot-pull-request-reviewer', status: 'completed', conclusion: 'failure' },
    ])).toEqual({ status: null, conclusion: null })
  })
})

describe('isAdvisoryCheckRun', () => {
  it('matches only review runs', () => {
    expect(isAdvisoryCheckRun({ name: 'copilot-pull-request-reviewer' })).toBe(true)
    expect(isAdvisoryCheckRun({ name: 'gate' })).toBe(false)
    expect(isAdvisoryCheckRun({})).toBe(false)
  })
})

describe('cloud-agent PRs reach the merge and CI paths', () => {
  const FUNCTIONS = resolve(__dirname, '../../supabase/functions')
  const ciSync = readFileSync(resolve(FUNCTIONS, 'ci-sync/index.ts'), 'utf8')

  it('parses the PR number a cloud agent hands back as a URL', () => {
    expect(prNumberFromUrl('https://github.com/kensaurus/glot.it/pull/141')).toBe(141)
    expect(prNumberFromUrl('https://github.com/kensaurus/glot.it/pull/141/files')).toBe(141)
    expect(prNumberFromUrl('https://github.com/kensaurus/glot.it')).toBeNull()
  })

  it('ci-sync backfills pr_number and commit_sha from the PR it reads', () => {
    expect(ciSync).toContain('pr_number: attempt.pr_number ?? prNumber')
    expect(ciSync).toContain('commit_sha: pr.headSha')
  })

  it('ci-sync reads CI on the PR head, falling back to the stored commit', () => {
    expect(ciSync).toContain('const sha = headSha ?? attempt.commit_sha')
    expect(ciSync).toContain('fetchLatestCheckRun(token, ref, sha)')
  })
})

describe('installationIdForAttempt', () => {
  const repos = [
    { id: 'r-docs', repo_url: 'https://github.com/kensaurus/sbc-docs', is_primary: true, github_app_installation_id: 111 },
    { id: 'r-be', repo_url: 'https://github.com/kensaurus/sbc_backend', is_primary: false, github_app_installation_id: 222 },
  ]
  const fakeDb = {
    from: () => ({
      select: () => {
        const filters: Record<string, unknown> = {}
        const q = {
          eq: (col: string, val: unknown) => { filters[col] = val; return q },
          maybeSingle: async () => ({ data: repos.find((r) => r.id === filters.id) ?? null }),
          then: (resolve: (v: { data: typeof repos }) => unknown) => resolve({ data: repos }),
        }
        return q
      },
    }),
  } as unknown as Parameters<typeof installationIdForAttempt>[0]

  it('matches the PR repository when the attempt has no repo_id', async () => {
    expect(await installationIdForAttempt(fakeDb, {
      project_id: 'p', repo_id: null, pr_url: 'https://github.com/kensaurus/sbc_backend/pull/9',
    })).toBe(222)
  })

  it('uses repo_id when the attempt has one', async () => {
    expect(await installationIdForAttempt(fakeDb, { project_id: 'p', repo_id: 'r-docs', pr_url: null })).toBe(111)
  })

  it('falls back to the primary repo without a PR URL', async () => {
    expect(await installationIdForAttempt(fakeDb, { project_id: 'p', repo_id: null, pr_url: null })).toBe(111)
  })
})
