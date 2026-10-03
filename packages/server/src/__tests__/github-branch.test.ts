/**
 * FILE: packages/server/src/__tests__/github-branch.test.ts
 * PURPOSE: Regression guard for the stale default branch (2026-10-02).
 *
 *          project_repos.default_branch said 'main' for kensaurus/mushi-mushi,
 *          which branches from 'master'. Every index sweep from 2026-06-20
 *          failed "tree fetch 404", the GitHub card stayed green, and the
 *          fix-worker lost its code context (draft PR #424). These tests pin
 *          the indexer fallback, the connect-time lookup and the probe signal.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  fetchRepoTreeWithBranchFallback,
  resolveBranchForConnect,
  type FetchLike,
} from '../../supabase/functions/_shared/github-branch.ts'
import {
  classifyIndexerError,
  isCodebaseIndexFailing,
} from '../../supabase/functions/_shared/sweep-error-classifier.ts'

const REPO = 'https://api.github.com/repos/kensaurus/mushi-mushi'

/** Fake GitHub: maps URL → [status, body]; records every call. */
function fakeGithub(routes: Record<string, [number, unknown]>) {
  const calls: string[] = []
  const fetchImpl: FetchLike = (url) => {
    calls.push(url)
    const [status, body] = routes[url] ?? [404, { message: 'Not Found' }]
    return Promise.resolve(new Response(JSON.stringify(body), { status }))
  }
  return { fetchImpl, calls }
}

const tree = { tree: [{ path: 'apps/docs/app/layout.tsx', type: 'blob' }], truncated: false }

describe('fetchRepoTreeWithBranchFallback (indexer)', () => {
  it("retries on GitHub's default branch when the configured one 404s", async () => {
    const gh = fakeGithub({
      [`${REPO}/git/trees/main?recursive=1`]: [404, { message: 'Not Found' }],
      [REPO]: [200, { default_branch: 'master' }],
      [`${REPO}/git/trees/master?recursive=1`]: [200, tree],
    })
    const result = await fetchRepoTreeWithBranchFallback({
      token: 't', owner: 'kensaurus', repo: 'mushi-mushi', branch: 'main', fetchImpl: gh.fetchImpl,
    })
    expect(result).toEqual({ tree, branch: 'master', correctedFrom: 'main' })
  })

  it('does not look anything up when the configured branch works', async () => {
    const gh = fakeGithub({ [`${REPO}/git/trees/main?recursive=1`]: [200, tree] })
    const result = await fetchRepoTreeWithBranchFallback({
      token: 't', owner: 'kensaurus', repo: 'mushi-mushi', branch: 'main', fetchImpl: gh.fetchImpl,
    })
    expect(result.correctedFrom).toBeNull()
    expect(gh.calls).toHaveLength(1)
  })

  it('keeps auth failures as-is, without a branch lookup', async () => {
    const gh = fakeGithub({ [`${REPO}/git/trees/main?recursive=1`]: [401, {}] })
    await expect(
      fetchRepoTreeWithBranchFallback({
        token: 't', owner: 'kensaurus', repo: 'mushi-mushi', branch: 'main', fetchImpl: gh.fetchImpl,
      }),
    ).rejects.toThrow(/^tree fetch 401$/)
    expect(gh.calls).toHaveLength(1)
  })

  it('names both branches when the default branch also fails', async () => {
    const gh = fakeGithub({
      [REPO]: [200, { default_branch: 'master' }],
      [`${REPO}/git/trees/master?recursive=1`]: [409, { message: 'Git Repository is empty.' }],
    })
    const err = await fetchRepoTreeWithBranchFallback({
      token: 't', owner: 'kensaurus', repo: 'mushi-mushi', branch: 'main', fetchImpl: gh.fetchImpl,
    }).catch((e: Error) => e)
    expect(String(err)).toMatch(/default branch 'master'.*configured branch 'main' returned 404/)
  })

  it('reports an inaccessible repo as such (classified as permission)', async () => {
    const gh = fakeGithub({})
    const err = await fetchRepoTreeWithBranchFallback({
      token: 't', owner: 'kensaurus', repo: 'mushi-mushi', branch: 'main', fetchImpl: gh.fetchImpl,
    }).catch((e: Error) => e)
    expect(String(err)).toMatch(/not accessible with this token/)
    expect(classifyIndexerError(err)).toBe('permission')
  })

  it('does not retry the same branch when it already is the GitHub default', async () => {
    const gh = fakeGithub({ [REPO]: [200, { default_branch: 'main' }] })
    await expect(
      fetchRepoTreeWithBranchFallback({
        token: 't', owner: 'kensaurus', repo: 'mushi-mushi', branch: 'main', fetchImpl: gh.fetchImpl,
      }),
    ).rejects.toThrow(/tree fetch 404 for branch 'main'/)
    expect(gh.calls).toHaveLength(2)
  })
})

describe('resolveBranchForConnect (repo connect)', () => {
  const base = { owner: 'kensaurus', repo: 'mushi-mushi', token: 't' }

  it("replaces the console's pre-filled 'main' with GitHub's real default", async () => {
    const gh = fakeGithub({ [REPO]: [200, { default_branch: 'master' }] })
    expect(await resolveBranchForConnect({ ...base, requested: 'main', fetchImpl: gh.fetchImpl })).toEqual({
      branch: 'master',
      source: 'github_default',
    })
  })

  it('uses the GitHub default when no branch is supplied', async () => {
    const gh = fakeGithub({ [REPO]: [200, { default_branch: 'master' }] })
    expect((await resolveBranchForConnect({ ...base, requested: '  ', fetchImpl: gh.fetchImpl })).branch).toBe('master')
  })

  it('keeps a deliberately chosen branch that exists', async () => {
    const gh = fakeGithub({
      [REPO]: [200, { default_branch: 'master' }],
      [`${REPO}/branches/develop`]: [200, { name: 'develop' }],
    })
    expect(await resolveBranchForConnect({ ...base, requested: 'develop', fetchImpl: gh.fetchImpl })).toEqual({
      branch: 'develop',
      source: 'requested',
    })
  })

  it('falls back to the supplied value when GitHub cannot be asked', async () => {
    expect(await resolveBranchForConnect({ ...base, token: null, requested: 'develop' })).toEqual({
      branch: 'develop',
      source: 'unverified',
    })
    const down = fakeGithub({ [REPO]: [503, {}] })
    expect(await resolveBranchForConnect({ ...base, requested: null, fetchImpl: down.fetchImpl })).toEqual({
      branch: 'main',
      source: 'unverified',
    })
    const throws: FetchLike = () => Promise.reject(new Error('fetch failed'))
    expect((await resolveBranchForConnect({ ...base, requested: 'main', fetchImpl: throws })).source).toBe('unverified')
  })
})

describe('isCodebaseIndexFailing (GitHub probe signal)', () => {
  it('flags the live mushi-mushi row: error and no successful index since June', () => {
    expect(
      isCodebaseIndexFailing({
        last_index_error: 'tree fetch 404',
        last_indexed_at: '2026-06-20 16:19:10.044+00',
        last_index_attempt_at: '2026-10-02 01:17:01.395+00',
      }),
    ).toBe(true)
  })

  it('ignores a benign partial note on a successful sweep', () => {
    expect(
      isCodebaseIndexFailing({
        last_index_error: 'partial: indexed 300 of 1844 eligible files (MUSHI_REPO_INDEX_SWEEP_FILE_CAP=300)',
        last_indexed_at: '2026-09-28 14:18:41.121+00',
        last_index_attempt_at: '2026-09-28 14:18:41.124+00',
      }),
    ).toBe(false)
  })

  it('flags a repo that has never indexed, and passes a clean one', () => {
    expect(
      isCodebaseIndexFailing({
        last_index_error: 'no_token: neither …',
        last_indexed_at: null,
        last_index_attempt_at: '2026-10-02 01:00:00+00',
      }),
    ).toBe(true)
    expect(
      isCodebaseIndexFailing({ last_index_error: null, last_indexed_at: null, last_index_attempt_at: null }),
    ).toBe(false)
  })
})

describe('wiring', () => {
  const fns = resolve(__dirname, '../../supabase/functions')
  const read = (p: string) => readFileSync(resolve(fns, p), 'utf8')

  it('the indexer uses the fallback and persists the corrected branch', () => {
    const src = read('webhooks-github-indexer/index.ts')
    expect(src).toMatch(/fetchRepoTreeWithBranchFallback\(/)
    expect(src).not.toMatch(/throw new Error\(`tree fetch \$\{treeRes\.status\}`\)/)
    // One bookkeeping update serves a failed and a successful sweep (gap 16a,
    // sweepOutcome), so the corrected branch is written once, beside the
    // outcome's columns and outside any `outcome.ok` branch.
    expect(src.match(/default_branch: stats\.correctedBranch/g)?.length).toBe(1)
    expect(src).toMatch(/\.\.\.outcome\.update,[\s\S]{0,400}\.\.\.\(stats\.correctedBranch \? \{ default_branch: stats\.correctedBranch \} : \{\}\)/)
  })

  it('both repo-connect routes resolve the branch from GitHub', () => {
    expect(read('api/routes/project-codebase.ts')).toMatch(/resolveBranchForConnect\(/)
    expect(read('api/routes/query-fixes-repo.ts')).toMatch(/resolveBranchForConnect\(/)
    expect(read('api/routes/project-codebase.ts')).not.toMatch(/body\.default_branch \?\? 'main'/)
    expect(read('api/routes/query-fixes-repo.ts')).not.toMatch(/default_branch: body\.defaultBranch \?\? 'main'/)
  })

  it('the GitHub probe degrades on a failing index', () => {
    expect(read('_shared/integration-probes.ts')).toMatch(/isCodebaseIndexFailing\(r\)/)
  })
})
