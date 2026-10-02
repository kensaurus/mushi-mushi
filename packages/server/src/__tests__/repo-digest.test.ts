/**
 * FILE: packages/server/src/__tests__/repo-digest.test.ts
 * PURPOSE: The repo digest (Plan 020 §10.3.1): ranking, the token budget and
 *          its truncation, secret redaction, the sensitive-file deny list,
 *          tree collapsing, and the GitHub calls staying pinned to one SHA.
 */

import { describe, expect, it } from 'vitest'
import {
  assembleRepoDigest,
  buildRepoDigest,
  digestCacheKeyInput,
  estimateTokens,
  globToRegExp,
  planRepoDigest,
  renderDigestTree,
  treePathSet,
  clampDigestBudget,
  MAX_DIGEST_BUDGET_TOKENS,
  type FetchedContent,
  type RepoTreeEntry,
} from '../../supabase/functions/_shared/repo-digest.ts'

// Built at runtime so the repo's own secret scanner does not flag the fixture.
const FAKE_ANTHROPIC_KEY = ['sk', 'ant', 'x'.repeat(28)].join('-')
const SHA = 'a'.repeat(40)

const META = { owner: 'acme', repo: 'shop', sha: SHA, ref: 'main', treeTruncated: false, scopeLabel: 'whole repo' }

function entries(spec: Record<string, number>): RepoTreeEntry[] {
  return Object.entries(spec).map(([path, size]) => ({ path, size }))
}

describe('globToRegExp', () => {
  it('matches a bare file name at any depth', () => {
    expect(globToRegExp('*.ts').test('src/a/b.ts')).toBe(true)
    expect(globToRegExp('*.ts').test('src/a/b.tsx')).toBe(false)
  })
  it('keeps * inside one folder and lets ** cross folders', () => {
    expect(globToRegExp('src/*.ts').test('src/a.ts')).toBe(true)
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false)
    expect(globToRegExp('src/**/*.ts').test('src/a.ts')).toBe(true)
    expect(globToRegExp('src/**/*.ts').test('src/a/b/c.ts')).toBe(true)
  })
  it('treats a trailing slash as the whole folder', () => {
    expect(globToRegExp('docs/').test('docs/x/y.md')).toBe(true)
    expect(globToRegExp('docs/').test('src/docs.ts')).toBe(false)
  })
  it('escapes regex characters', () => {
    expect(globToRegExp('a+b.(x).ts').test('a+b.(x).ts')).toBe(true)
    expect(globToRegExp('a+b.(x).ts').test('aab.x.ts')).toBe(false)
  })
})

describe('planRepoDigest', () => {
  const tree = entries({
    'README.md': 400,
    'package.json': 300,
    'AGENTS.md': 200,
    'src/index.ts': 400,
    'src/lib/cart.ts': 800,
    'src/lib/pay.ts': 800,
    'tests/cart.test.ts': 400,
    'pnpm-lock.yaml': 90_000,
    'public/logo.png': 4000,
    '.env': 100,
    '.env.example': 100,
    'certs/server.pem': 100,
    'node_modules/x/index.js': 100,
    'dist/bundle.js': 100,
    'data/huge.json': 900_000,
  })

  it('puts linked files first, then README, docs, manifests, entry points, source, tests', () => {
    const plan = planRepoDigest(tree, { seedPaths: ['src/lib/pay.ts', 'not/in/tree.ts'] })
    expect(plan.selected.map((f) => f.path)).toEqual([
      'src/lib/pay.ts',
      'README.md',
      'AGENTS.md',
      'package.json',
      'src/index.ts',
      'src/lib/cart.ts',
      'tests/cart.test.ts',
    ])
    expect(plan.selected[0].rank).toBe('linked')
    expect(plan.seedsInTree).toEqual(['src/lib/pay.ts'])
  })

  it('never selects sensitive files, even when an include glob names them', () => {
    const plan = planRepoDigest(tree, { include: ['.env*', '*.pem', '*.ts'] })
    const picked = plan.selected.map((f) => f.path)
    expect(picked).not.toContain('.env')
    expect(picked).not.toContain('.env.example')
    expect(picked).not.toContain('certs/server.pem')
    const reasons = Object.fromEntries(plan.dropped.map((d) => [d.path, d.reason]))
    expect(reasons['.env']).toBe('sensitive_file')
    expect(reasons['certs/server.pem']).toBe('sensitive_file')
  })

  it('drops vendor folders from the tree and skips lockfiles, binaries and huge files', () => {
    const plan = planRepoDigest(tree)
    expect(plan.treePaths).not.toContain('node_modules/x/index.js')
    expect(plan.treePaths).not.toContain('dist/bundle.js')
    const reasons = Object.fromEntries(plan.dropped.map((d) => [d.path, d.reason]))
    expect(reasons['pnpm-lock.yaml']).toBe('lockfile')
    expect(reasons['public/logo.png']).toBe('binary')
    expect(reasons['data/huge.json']).toBe('too_large')
  })

  it('lets an include glob bring a lockfile back', () => {
    const plan = planRepoDigest(entries({ 'yarn.lock': 400, 'src/a.ts': 100 }), { include: ['yarn.lock'] })
    expect(plan.selected.map((f) => f.path)).toEqual(['yarn.lock'])
    expect(plan.dropped.find((d) => d.path === 'src/a.ts')?.reason).toBe('not_included')
  })

  it('applies exclude globs to the tree and the contents', () => {
    const plan = planRepoDigest(tree, { exclude: ['tests/'] })
    expect(plan.treePaths).not.toContain('tests/cart.test.ts')
    expect(plan.selected.map((f) => f.path)).not.toContain('tests/cart.test.ts')
  })

  it('restricts to a folder with pathPrefix but keeps linked files', () => {
    const plan = planRepoDigest(tree, { pathPrefix: './src/lib/', seedPaths: ['README.md'] })
    expect(plan.selected.map((f) => f.path)).toEqual(['README.md', 'src/lib/cart.ts', 'src/lib/pay.ts'])
  })

  it('drops the lowest-priority files first when the budget runs out', () => {
    const big = entries({
      'README.md': 2_000,
      'src/a.ts': 6_000,
      'src/b.ts': 6_000,
      'tests/a.test.ts': 6_000,
    })
    // 2,000-token budget: 400 reserved for the tree, ~1,400 for contents.
    // README (~515) fits; each 1,500-token source file does not, and source
    // files are dropped rather than cut.
    const plan = planRepoDigest(big, { budgetTokens: 2_000 })
    expect(plan.selected.map((f) => f.path)).toEqual(['README.md'])
    const over = plan.dropped.filter((d) => d.reason === 'over_budget').map((d) => d.path)
    expect(over).toEqual(['src/a.ts', 'src/b.ts', 'tests/a.test.ts'])
  })

  it('cuts a high-priority file to fit instead of dropping it', () => {
    const plan = planRepoDigest(entries({ 'README.md': 40_000 }), { budgetTokens: 5_000 })
    expect(plan.selected).toHaveLength(1)
    expect(plan.selected[0].truncatable).toBe(true)
    expect(plan.selected[0].estTokens).toBeLessThan(5_000)
  })

  it('clamps the budget', () => {
    expect(clampDigestBudget(10)).toBe(2_000)
    expect(clampDigestBudget(10_000_000)).toBe(MAX_DIGEST_BUDGET_TOKENS)
    expect(clampDigestBudget('abc')).toBe(50_000)
  })
})

describe('assembleRepoDigest', () => {
  it('replaces a secret-bearing file with a notice and never emits the secret', () => {
    const plan = planRepoDigest(entries({ 'README.md': 100, 'src/config.ts': 200 }))
    const contents = new Map<string, FetchedContent>([
      ['README.md', '# Shop\nA small shop.'],
      ['src/config.ts', `export const KEY = '${FAKE_ANTHROPIC_KEY}'\n`],
    ])
    const digest = assembleRepoDigest(plan, contents, META)
    expect(digest.text).not.toContain(FAKE_ANTHROPIC_KEY)
    expect(digest.redacted).toEqual([{ path: 'src/config.ts', label: 'Anthropic key' }])
    expect(digest.text).toContain("Mushi left this file's contents out: it looks like it holds a secret (Anthropic key).")
    expect(digest.text).toContain('FILE: README.md')
    expect(digest.text).toContain(`Commit: ${SHA} (main)`)
  })

  it('also catches keys the shared scanner does not (Google, Stripe test)', () => {
    const google = ['AIza', 'B'.repeat(35)].join('')
    const stripe = ['sk', 'test', 'C'.repeat(24)].join('_')
    const plan = planRepoDigest(entries({ 'a.ts': 100, 'b.ts': 100 }))
    const digest = assembleRepoDigest(
      plan,
      new Map<string, FetchedContent>([['a.ts', `k = '${google}'`], ['b.ts', `s = '${stripe}'`]]),
      META,
    )
    expect(digest.text).not.toContain(google)
    expect(digest.text).not.toContain(stripe)
    expect(digest.redacted.map((r) => r.label).sort()).toEqual(['Google API key', 'Stripe test key'])
  })

  it('records binary and unreadable files as left out', () => {
    const plan = planRepoDigest(entries({ 'a.ts': 100, 'b.ts': 100 }))
    const contents = new Map<string, FetchedContent>([['a.ts', { binary: true }], ['b.ts', null]])
    const digest = assembleRepoDigest(plan, contents, META)
    expect(digest.files).toEqual([])
    expect(digest.dropped_counts).toEqual({ binary: 1, fetch_failed: 1 })
    expect(digest.text).toContain('Left out: 1 binary files and assets; 1 could not be read from GitHub')
  })

  it('enforces the budget on the real text and cuts a README that is longer than its blob estimate', () => {
    const plan = planRepoDigest(entries({ 'README.md': 100 }), { budgetTokens: 3_000 })
    const longReadme = Array.from({ length: 2_000 }, (_, i) => `line ${i} of a very long readme`).join('\n')
    const digest = assembleRepoDigest(plan, new Map([['README.md', longReadme]]), META)
    expect(digest.files[0].truncated).toBe(true)
    expect(digest.text).toMatch(/FILE: README\.md \(cut to fit: first \d+ of 2000 lines\)/)
    expect(digest.total_tokens).toBeLessThanOrEqual(3_000)
  })

  it('reports the estimate against the budget in the header', () => {
    const plan = planRepoDigest(entries({ 'README.md': 100 }), { budgetTokens: 10_000 })
    const digest = assembleRepoDigest(plan, new Map([['README.md', 'hi']]), META)
    expect(digest.text).toMatch(/About [\d,]+ tokens of a 10,000 budget \(estimate: characters \/ 4\)\./)
    expect(digest.total_tokens).toBe(estimateTokens(digest.text))
  })
})

describe('renderDigestTree', () => {
  it('collapses deep folders to file counts when the tree is over its share', () => {
    const paths = Array.from({ length: 400 }, (_, i) => `apps/web/src/components/feature-${i}/index.tsx`)
    const full = renderDigestTree(paths, 1_000_000)
    expect(full.collapsed).toBe(false)
    const small = renderDigestTree(paths, 50)
    expect(small.collapsed).toBe(true)
    expect(small.text).toContain('(400 files)')
    expect(estimateTokens(small.text)).toBeLessThanOrEqual(50)
  })
})

describe('treePathSet', () => {
  it('holds every file and every folder above it', () => {
    const set = treePathSet(entries({ 'a/b/c.ts': 1, 'd.ts': 1 }))
    expect([...set].sort()).toEqual(['a', 'a/b', 'a/b/c.ts', 'd.ts'])
  })
})

describe('digestCacheKeyInput', () => {
  it('ignores glob order, whitespace and the clamped budget form', () => {
    const a = digestCacheKeyInput({ include: ['b', ' a'], budgetTokens: 1e9 }, 'repo')
    const b = digestCacheKeyInput({ include: ['a', 'b'], budgetTokens: MAX_DIGEST_BUDGET_TOKENS }, 'repo')
    expect(a).toBe(b)
    expect(digestCacheKeyInput({ budgetTokens: 25_000 }, 'repo')).not.toBe(digestCacheKeyInput({ budgetTokens: 50_000 }, 'repo'))
  })
  it('keeps each scope apart: repo, folder, and each report', () => {
    const keys = new Set([
      digestCacheKeyInput({}, 'repo'),
      digestCacheKeyInput({ pathPrefix: 'src' }, 'path'),
      digestCacheKeyInput({}, 'report:r1'),
      digestCacheKeyInput({}, 'report:r2'),
    ])
    expect(keys.size).toBe(4)
  })
})

describe('buildRepoDigest (GitHub I/O)', () => {
  it('pins every read to the resolved SHA and uses the GitHub default branch', async () => {
    const calls: string[] = []
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push(url)
      const accept = (init?.headers as Record<string, string>)?.Accept
      if (url === 'https://api.github.com/repos/acme/shop') return Response.json({ default_branch: 'master' })
      if (url === 'https://api.github.com/repos/acme/shop/commits/master') {
        expect(accept).toBe('application/vnd.github.sha')
        return new Response(SHA)
      }
      if (url === `https://api.github.com/repos/acme/shop/git/trees/${SHA}?recursive=1`) {
        return Response.json({
          truncated: false,
          tree: [
            { path: 'README.md', type: 'blob', size: 20 },
            { path: 'src', type: 'tree' },
            { path: 'src/a b.ts', type: 'blob', size: 20 },
            { path: 'vendor-sub', type: 'commit' },
          ],
        })
      }
      if (url === `https://api.github.com/repos/acme/shop/contents/README.md?ref=${SHA}`) return new Response('# Shop')
      if (url === `https://api.github.com/repos/acme/shop/contents/src/a%20b.ts?ref=${SHA}`) {
        expect(accept).toBe('application/vnd.github.raw')
        return new Response('export const a = 1\n')
      }
      return new Response('not found', { status: 404 })
    }
    const digest = await buildRepoDigest({ token: 't', owner: 'acme', repo: 'shop', fetchImpl })
    expect(digest.sha).toBe(SHA)
    expect(digest.ref).toBe('master')
    expect(digest.files.map((f) => f.path)).toEqual(['README.md', 'src/a b.ts'])
    expect(digest.text).toContain('export const a = 1')
    expect(calls.filter((u) => u.includes('/contents/')).every((u) => u.endsWith(`?ref=${SHA}`))).toBe(true)
  })

  it('treats a NUL byte as binary', async () => {
    const fetchImpl = async (url: string): Promise<Response> => {
      if (url.endsWith('/commits/v1')) return new Response(SHA)
      if (url.includes('/git/trees/')) return Response.json({ tree: [{ path: 'blob.dat', type: 'blob', size: 4 }] })
      return new Response(new Uint8Array([65, 0, 66, 67]))
    }
    const digest = await buildRepoDigest({ token: 't', owner: 'acme', repo: 'shop', ref: 'v1', fetchImpl })
    expect(digest.files).toEqual([])
    expect(digest.dropped_counts.binary).toBe(1)
  })
})
