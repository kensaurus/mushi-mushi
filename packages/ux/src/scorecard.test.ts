// SPDX-License-Identifier: MIT
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { captureFolder, FACTS_SCRIPT, readCaptures, runScorecard, scorecardRunId, type Scorer } from './scorecard.js'
import { mergeGrouping, UX_DIMENSIONS, type UxPageFacts, type UxPageScore } from './scorecard-rubric.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function facts(key: string, label: string, text: string): UxPageFacts {
  return { key, path: key, label, title: `${label} — App`, headings: [label], text, controls: [], settleMs: 1200, axe: { critical: 0, serious: 0, rules: [] }, overflowX: false, consoleErrors: 0, cls: 0, viewport: { width: 1440, height: 900 } }
}

function capturesDir(pages: UxPageFacts[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'scorecard-'))
  dirs.push(dir)
  for (const f of pages) {
    const folder = join(dir, 'pages', captureFolder(f.key))
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'facts.json'), JSON.stringify(f))
    writeFileSync(join(folder, 'settled.png'), Buffer.from([]))
  }
  return dir
}

/** A scorer that answers from a table, the way a model would, through the real parser. */
function fakeScorer(answers: Record<string, { overall: number; issues: UxPageScore['issues'] }>): Scorer {
  return {
    name: 'fake',
    async score(f) {
      const a = answers[f.key]
      if (!a) return { error: 'no answer' }
      const scores = Object.fromEntries(UX_DIMENSIONS.map((d) => [d, a.overall])) as UxPageScore['scores']
      return { score: { key: f.key, page: f.label, scores, why: {}, capped: {}, overall: a.overall, issues: a.issues, claims: [], promptVersion: 'test' } }
    },
    async group(pages, base, prior) {
      return { causes: mergeGrouping(pages, base, { causes: [] }, prior) }
    },
  }
}

const banner = (title: string) => ({
  dimension: 'truthfulness' as const,
  severity: 'medium' as const,
  title,
  problem: 'The one-app banner shows on a page about the whole team',
  evidence: 'This page shows one app at a time',
  fix: 'Mark team pages as not app-scoped in the scope registry',
  cause: 'project scope registry',
  confidence: 0.8,
  evidenceSeen: true,
})

describe('the UX scorecard run', () => {
  it('a run id matches the console format', () => {
    expect(scorecardRunId(new Date('2026-11-21T10:05:09Z'), () => 0)).toBe('20261121-100509-aaaa')
    expect(scorecardRunId(new Date())).toMatch(/^[0-9]{8}-[0-9]{6}-[a-z0-9]{4}$/)
  })

  it('a page key becomes a folder name', () => {
    expect(captureFolder('/team?view=sso')).toBe('team-view-sso')
    expect(captureFolder('/')).toBe('root')
  })

  it('reads captures from disk and keeps each page view as its own key', () => {
    const dir = capturesDir([{ ...facts('/team?view=sso&project=1', 'Single sign-on', 'x'), key: '/team?project=1&view=sso' }])
    expect(readCaptures(dir).map((c) => c.facts.key)).toEqual(['/team?view=sso'])
    expect(readCaptures(join(dir, 'missing'))).toEqual([])
  })

  it('scores captures without a browser, groups the shared cause and writes the scorecard', async () => {
    const dir = capturesDir([
      facts('/team?view=billing', 'Billing', 'This page shows one app at a time: lets-talk. Team plan covers every app.'),
      facts('/feedback', 'Help & support', 'This page shows one app at a time: lets-talk. Contact us.'),
      facts('/queue', 'Processing jobs', 'Oldest pending job is 34865m old'),
    ])
    const result = await runScorecard({
      url: 'https://example.com/admin/',
      app: 'Example',
      fromCaptures: dir,
      runId: '20261121-100000-test',
      scorer: fakeScorer({
        '/team?view=billing': { overall: 6, issues: [banner('Scope bar on billing')] },
        '/feedback': { overall: 6, issues: [banner('One-app bar on help')] },
      }),
    })
    expect(result.pages.filter((p) => p.score).map((p) => p.facts.key).sort()).toEqual(['/feedback', '/team?view=billing'])
    expect(result.pages.find((p) => p.facts.key === '/queue')?.error).toBe('Not scored: no answer')
    const shared = result.causes.find((c) => c.kind === 'shared')
    expect(shared?.pages.map((p) => p.key).sort()).toEqual(['/feedback', '/team?view=billing'])
    expect(existsSync(join(dir, 'scorecard.md'))).toBe(true)
    expect(readFileSync(join(dir, 'scorecard.md'), 'utf8')).toContain('### 6 · Billing (`/team?view=billing`)')
    expect(JSON.parse(readFileSync(join(dir, 'scorecard.json'), 'utf8')).scoredBy).toBe('fake')
  })

  it('the in-page facts script is one expression any driver can evaluate', () => {
    expect(FACTS_SCRIPT.startsWith('(() => {')).toBe(true)
    expect(FACTS_SCRIPT.trim().endsWith('})()')).toBe(true)
    expect(() => new Function(`return ${FACTS_SCRIPT.replace(/\(\)\s*$/, '')}`)).not.toThrow()
  })
})

describe('a server-scored run keeps its screenshots', () => {
  it('the server scorer remembers what it uploaded, and the final sync sends those names, not []', async () => {
    const { serverScorer, syncScorecard } = await import('./scorecard.js')
    const { topCauses } = await import('./scorecard-rubric.js')
    const dir = capturesDir([facts('/queue', 'Processing jobs', 'Oldest pending job is 2400m old')])
    writeFileSync(join(dir, 'pages', 'queue', 'early.png'), Buffer.from([1]))
    const calls: Array<{ url: string; method: string; body: string }> = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : '' })
      const json = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (url.endsWith('/uploads')) {
        const names = (JSON.parse(String(init?.body)) as { names: string[] }).names
        return json({ uploads: names.map((name) => ({ name, signedUrl: `https://storage.test/${name}` })) })
      }
      if (url.startsWith('https://storage.test/')) return new Response('', { status: 200 })
      if (url.endsWith('/score')) {
        const scores = Object.fromEntries(UX_DIMENSIONS.map((d) => [d, 5])) as UxPageScore['scores']
        return json({ score: { key: '/queue', page: 'x', scores, why: {}, capped: {}, overall: 5, issues: [], claims: [], promptVersion: 'test' } })
      }
      return json({ id: 'run' })
    }) as typeof fetch
    try {
      const cfg = { apiKey: 'k', projectId: 'p', endpoint: 'https://api.test', mode: 'local' as const }
      const scorer = serverScorer(cfg, '20261121-130357-tfwt')
      const f = readCaptures(dir)[0]
      const s = await scorer.score(f.facts, f.folder, { app: 'Mushi', otherPages: [] })
      expect(s.score?.overall).toBe(5)
      expect(scorer.uploaded?.get('/queue')).toEqual(['queue/early.png', 'queue/settled.png'])
      await syncScorecard(cfg, {
        runId: '20261121-130357-tfwt',
        url: 'https://kensaur.us/mushi-mushi/admin/',
        viewport: { width: 1440, height: 900 },
        scoredBy: 'server',
        startedAt: '2026-11-21T13:03:57Z',
        finished: true,
        pages: [{ facts: f.facts, folder: f.folder, score: s.score }],
        causes: topCauses([]),
        uploaded: scorer.uploaded,
      })
      const put = calls.find((c) => c.method === 'PUT' && c.url.startsWith('https://api.test'))!
      expect((JSON.parse(put.body) as { pages: Array<{ shots: string[] }> }).pages[0].shots).toEqual(['queue/early.png', 'queue/settled.png'])
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
