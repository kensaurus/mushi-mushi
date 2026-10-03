/**
 * createPrFromFiles `markReady` (Plan 019 decision 5): fix-worker and
 * sdk-upgrade-worker keep their PRs readied by default; recipe PRs pass
 * `markReady: false` and stay drafts so the host's CI does not run.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const markPullRequestReady = vi.fn(async () => ({ ok: true, alreadyReady: false }))
vi.mock('../../supabase/functions/_shared/github.ts', () => ({ markPullRequestReady }))

let createPrFromFiles: typeof import('../../supabase/functions/_shared/github-pr.ts')['createPrFromFiles']

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }
  ;({ createPrFromFiles } = await import('../../supabase/functions/_shared/github-pr.ts'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  markPullRequestReady.mockClear()
})

function stubGithub() {
  const calls: Array<{ url: string; method: string; body: unknown }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : null })
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/git/refs/heads/')) return json({ object: { sha: 'base' } })
    if (method === 'GET' && /\/repos\/o\/r$/.test(url)) return json({ default_branch: 'main' })
    if (url.endsWith('/git/refs') && method === 'POST') return json({ ref: 'refs/heads/x' }, 201)
    if (url.includes('/contents/') && method === 'GET') return json({ message: 'Not Found' }, 404)
    if (url.includes('/contents/') && method === 'PUT') return json({ commit: { sha: 'c1' } }, 201)
    if (url.endsWith('/pulls') && method === 'POST') return json({ number: 7, html_url: 'https://github.com/o/r/pull/7' }, 201)
    return json({}, 200)
  }))
  return calls
}

const opts = {
  token: 't', owner: 'o', repo: 'r', defaultBranch: 'main', branch: 'mushi/recipe-design-1',
  title: 'chore(design): update design tokens', body: 'b',
  files: [{ path: 'tokens/a.tokens.json', contents: '{}\n', reason: 'update a' }],
}

describe('createPrFromFiles markReady', () => {
  it('opens a draft and leaves it a draft when markReady is false', async () => {
    const calls = stubGithub()
    const pr = await createPrFromFiles({ ...opts, markReady: false })
    expect(pr.number).toBe(7)
    const open = calls.find((c) => c.url.endsWith('/pulls') && c.method === 'POST')
    expect(open?.body).toMatchObject({ draft: true })
    expect(markPullRequestReady).not.toHaveBeenCalled()
  })

  it('still readies the PR by default (fix-worker / sdk-upgrade-worker behaviour)', async () => {
    stubGithub()
    await createPrFromFiles(opts)
    expect(markPullRequestReady).toHaveBeenCalledTimes(1)
  })
})
