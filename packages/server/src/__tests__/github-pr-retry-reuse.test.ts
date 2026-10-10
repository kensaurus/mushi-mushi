/**
 * FILE: github-pr-retry-reuse.test.ts
 * PURPOSE: Two retry/template gaps in _shared/github-pr.ts.
 *          1. Branch creation tolerated an existing ref, but a retried run
 *             whose PR was already open got 422 "A pull request already
 *             exists" from POST /pulls and failed. It now reuses that PR when
 *             it is safe to (bot-authored, or its head is the commit this run
 *             pushed).
 *          2. Branch templates were expanded with String.replace, so a
 *             repeated token (`{shortId}-{shortId}`) stayed literal and the
 *             template was silently replaced by the default name.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const markPullRequestReady = vi.fn(async () => ({ ok: true, alreadyReady: false }))
vi.mock('../../supabase/functions/_shared/github.ts', () => ({ markPullRequestReady }))

type GithubPr = typeof import('../../supabase/functions/_shared/github-pr.ts')
let createPrFromFiles: GithubPr['createPrFromFiles']
let generateFixBranchName: GithubPr['generateFixBranchName']
let validateFixBranchTemplate: GithubPr['validateFixBranchTemplate']

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  ;({ createPrFromFiles, generateFixBranchName, validateFixBranchTemplate } = await import(
    '../../supabase/functions/_shared/github-pr.ts'
  ))
})

afterEach(() => {
  vi.unstubAllGlobals()
  markPullRequestReady.mockClear()
})

const BRANCH = 'bugfix/MUSHI-0123abcd-0000-4000-8000-000000000001-crash'

/** GitHub stub where POST /pulls answers 422 and GET /pulls lists `open`. */
function stubGithubWithOpenPr(open: unknown[]) {
  const calls: Array<{ url: string; method: string }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ url, method })
    const json = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/git/refs/heads/')) return json({ object: { sha: 'base' } })
    if (method === 'GET' && /\/repos\/o\/r$/.test(url)) return json({ default_branch: 'main' })
    if (url.endsWith('/git/refs') && method === 'POST') return json({ message: 'Reference already exists' }, 422)
    if (url.includes('/contents/') && method === 'GET') return json({ message: 'Not Found' }, 404)
    if (url.includes('/contents/') && method === 'PUT') return json({ commit: { sha: 'c1' } }, 201)
    if (url.endsWith('/pulls') && method === 'POST') {
      return json({
        message: 'Validation Failed',
        errors: [{ resource: 'PullRequest', code: 'custom', message: `A pull request already exists for o:${BRANCH}.` }],
      }, 422)
    }
    if (url.includes('/pulls?') && method === 'GET') return json(open)
    return json({}, 200)
  }))
  return calls
}

const opts = {
  token: 't', owner: 'o', repo: 'r', defaultBranch: 'main', branch: BRANCH,
  title: 'fix: crash', body: 'b',
  files: [{ path: 'src/a.ts', contents: 'x\n', reason: 'fix a' }],
}

const openPr = (over: Record<string, unknown>) => ({
  number: 9,
  html_url: 'https://github.com/o/r/pull/9',
  head: { ref: BRANCH, sha: 'someone-else' },
  base: { ref: 'main' },
  user: { type: 'User' },
  ...over,
})

describe('createPrFromFiles on a retried run', () => {
  it('reuses the open PR whose head is the commit this run pushed', async () => {
    const calls = stubGithubWithOpenPr([openPr({ head: { ref: BRANCH, sha: 'c1' } })])
    const pr = await createPrFromFiles(opts)
    expect(pr).toMatchObject({ number: 9, url: 'https://github.com/o/r/pull/9', commitSha: 'c1' })
    const lookup = calls.find((c) => c.method === 'GET' && c.url.includes('/pulls?'))
    expect(lookup?.url).toContain(`head=${encodeURIComponent(`o:${BRANCH}`)}`)
    expect(markPullRequestReady).toHaveBeenCalledTimes(1)
  })

  it('reuses a bot-authored open PR for the branch', async () => {
    stubGithubWithOpenPr([openPr({ user: { type: 'Bot' } })])
    const pr = await createPrFromFiles(opts)
    expect(pr.number).toBe(9)
  })

  it('does not adopt a human PR carrying other commits; the 422 still fails', async () => {
    stubGithubWithOpenPr([openPr({})])
    await expect(createPrFromFiles(opts)).rejects.toThrow(/422/)
  })

  it('does not adopt an open PR into a different base', async () => {
    stubGithubWithOpenPr([openPr({ user: { type: 'Bot' }, base: { ref: 'release' } })])
    await expect(createPrFromFiles(opts)).rejects.toThrow(/422/)
  })
})

describe('fix branch templates with a repeated token', () => {
  const reportId = '0123abcd-0000-4000-8000-000000000001'

  it('expands every occurrence', () => {
    const name = generateFixBranchName(reportId, 'bugfix/MUSHI-{reportId}-{shortId}-{shortId}', 'bug')
    expect(name).toBe(`bugfix/MUSHI-${reportId}-0123abcd-0123abcd`)
  })

  it('validates a template that repeats a token', () => {
    expect(() => validateFixBranchTemplate('bugfix/MUSHI-{reportId}-{shortId}-{shortId}')).not.toThrow()
  })
})
