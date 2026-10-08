/**
 * FILE: packages/server/src/__tests__/fix-context.test.ts
 * PURPOSE: The fix model's "Relevant code" (2026-10-03). Eight real Sentry
 *          dispatches ended in review_failed because the context was
 *          truncated index previews and the file emitting the error was not
 *          in it. These tests pin the literal extraction that finds that
 *          file, the ranking, and the full-file builder's caps and labels.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  attributeIndexPath,
  buildFullFileContext,
  extractReportLiterals,
  globRoot,
  isBundledPath,
  isLocaleFile,
  localeKeysForText,
  literalSearchTerms,
  rankContextCandidates,
  underRepoGlobs,
  type ContextCandidate,
} from '../../supabase/functions/_shared/fix-context.ts'
import type { BaseFileState } from '../../supabase/functions/_shared/fix-file-guard.ts'

describe('extractReportLiterals', () => {
  it('pulls the literals the failed dispatches were missing', () => {
    const r = extractReportLiterals({
      summary: "Pattern list fails to load with 'fetch_patterns_failed'",
      description:
        'supabase.get_partner_failed in loadPartner(app/lib/partners)\n\n(captured by Sentry — no user description)',
      console_logs: [
        { level: 'error', message: '[ota] update check failed: ota:manifest-504', stack: 'Error: ota:manifest-504\n  at check (dist-bundle/index.mjs:1:2)' },
        { level: 'info', message: 'ignored_info_literal' },
      ],
      custom_metadata: { culprit: 'supabase.get_partner_failed' },
      environment: { url: 'https://app.example.com/partners/123/edit?tab=1' },
    })
    expect(r.literals).toContain('fetch_patterns_failed')
    expect(r.literals).toContain('supabase.get_partner_failed')
    expect(r.literals).toContain('ota:manifest-504')
    expect(r.literals).not.toContain('ignored_info_literal')
    expect(r.literals[0]).toBe('fetch_patterns_failed') // quoted strings first
    expect(r.literals.length).toBeLessThanOrEqual(6)
  })

  it('ignores bundled stack frames and keeps source frames', () => {
    const r = extractReportLiterals({
      custom_metadata: {
        sentryFrames: ['dist-bundle/index.mjs', 'src/lib/partners.ts', 'build/server.js', 'assets/main-3f9a2b1c8d.js'],
      },
    })
    expect(r.framePaths).toEqual(['src/lib/partners.ts'])
  })

  it('reads frames from stored stack text when sentryFrames is missing', () => {
    const r = extractReportLiterals({
      console_logs: [{ level: 'error', message: 'boom', stack: 'TypeError: x\n  at go (app:///src/ota/check.ts:10:3)\n  at run (dist-bundle/main.mjs:1:1)' }],
    })
    expect(r.framePaths).toEqual(['src/ota/check.ts'])
  })

  it('drops search qualifiers, URLs, ids and generic words from untrusted report text', () => {
    const r = extractReportLiterals({
      summary: 'Broken "repo:evil/other" page "https://x.dev/a_b" id 3f2a9c1e-1111-2222-3333-444455556666 user_id TypeError',
      description: 'something went wrong',
    })
    expect(r.literals.some((l) => /repo:|https?:/.test(l))).toBe(false)
    expect(r.literals).not.toContain('user_id')
    expect(r.literals).not.toContain('TypeError')
    expect(r.literals.some((l) => /3f2a9c1e/.test(l))).toBe(false)
  })

  it('adds the route, but never a Sentry link', () => {
    expect(extractReportLiterals({ environment: { url: 'https://app.example.com/checkout/confirm?x=1' } }).literals).toEqual([
      '/checkout/confirm',
    ])
    expect(extractReportLiterals({ environment: { url: 'https://acme.sentry.io/issues/123/' } }).literals).toEqual([])
  })
})

describe('literalSearchTerms (runtime-built strings)', () => {
  it('reaches the stem glot.it actually has in source for ota:manifest-504', () => {
    // glot.it lib/native-bridge/live-update.ts: `ota:${reason}` + `manifest-${res.status}`
    const terms = literalSearchTerms('ota:manifest-504')
    expect(terms).toEqual(['ota:manifest-504', 'ota:manifest-', 'manifest-504', 'manifest-'])
    const source = 'const reason = `manifest-${res.status}`;\ncaptureSentryException(new Error(`ota:${reason}`))'
    expect(terms.find((t) => source.includes(t))).toBe('manifest-')
  })

  it('tries the bare name when the namespace is added at runtime, and keeps verbatim literals first', () => {
    expect(literalSearchTerms('supabase.get_partner_failed')).toEqual(['supabase.get_partner_failed', 'get_partner_failed'])
    expect(literalSearchTerms('fetch_patterns_failed')).toEqual(['fetch_patterns_failed'])
  })

  it('never produces a stem too short or without letters', () => {
    expect(literalSearchTerms('ab:12345')).toEqual(['ab:12345'])
    expect(literalSearchTerms('/checkout/confirm')).toEqual(['/checkout/confirm'])
  })
})

describe('isBundledPath', () => {
  it.each(['dist-bundle/index.mjs', 'dist/server.js', 'build/app.js', '.vercel/output/fn.js', 'static/main.bundle.js', 'assets/index-a1b2c3d4e5.js'])(
    'treats %s as bundle output',
    (p) => expect(isBundledPath(p)).toBe(true),
  )
  it.each(['src/lib/partners.ts', 'supabase/functions/api/index.ts', 'app/routes/checkout.tsx', 'scripts/build-docs.mjs'])(
    'keeps %s',
    (p) => expect(isBundledPath(p)).toBe(false),
  )
})

describe('rankContextCandidates', () => {
  it('puts literal hits ahead of stack frames ahead of RAG, and merges RAG chunks per file', () => {
    const ranked = rankContextCandidates({
      literalHits: new Map([['src/partners.ts', ['supabase.get_partner_failed']]]),
      framePaths: ['src/ota/check.ts'],
      rag: [
        { filePath: 'src/unrelated.ts', preview: 'a', similarity: 0.95, lineStart: 1, lineEnd: 1 },
        { filePath: 'src/ota/check.ts', preview: 'late', similarity: 0.5, lineStart: 40, lineEnd: 41 },
        { filePath: 'src/ota/check.ts', preview: 'early', similarity: 0.7, lineStart: 2, lineEnd: 3 },
      ],
    })
    expect(ranked.map((c) => c.path)).toEqual(['src/partners.ts', 'src/ota/check.ts', 'src/unrelated.ts'])
    const check = ranked[1]
    expect(check.inStack).toBe(true)
    expect(check.ragSimilarity).toBe(0.7)
    expect(check.previews.map((p) => p.text)).toEqual(['early', 'late'])
  })
})

describe('repo attribution (multi-repo projects)', () => {
  // solo-boss-cloud: frontend and backend repos both own src/**; the index
  // (match_codebase_files) is keyed by project, not repo.
  const backend = { targetGlobs: ['src/**', 'supabase/**'], otherRepoGlobs: [['src/**', 'public/**']] }

  it('attributes paths by every glob of the target and of the sibling repos', () => {
    expect(attributeIndexPath('supabase/functions/api.ts', backend)).toBe('target')
    expect(attributeIndexPath('public/logo.svg', backend)).toBe('other')
    expect(attributeIndexPath('src/App.tsx', backend)).toBe('unknown')
    expect(attributeIndexPath('srcfoo/x.ts', backend)).toBe('other') // whole segments only
    expect(attributeIndexPath('anything.ts', { targetGlobs: null, otherRepoGlobs: [] })).toBe('target')
    expect(attributeIndexPath('apps/web/x.ts', { targetGlobs: null, otherRepoGlobs: [null] })).toBe('unknown')
    expect(globRoot('./apps/web/**')).toBe('apps/web')
    expect(underRepoGlobs('apps/web/x.ts', ['apps/web/*'])).toBe(true)
  })

  it('drops another repo\'s index hits and never carries an unattributable preview', () => {
    const ranked = rankContextCandidates({
      literalHits: new Map([['src/server.ts', ['get_partner_failed']]]), // code search on the target repo
      indexLiteralHits: new Map([['public/sw.js', ['get_partner_failed']], ['src/App.tsx', ['get_partner_failed']]]),
      framePaths: [],
      indexFramePaths: ['public/app.js'],
      rag: [
        { filePath: 'src/App.tsx', preview: 'frontend preview text', similarity: 0.9, lineStart: 1, lineEnd: 1 },
        { filePath: 'supabase/functions/api.ts', preview: 'backend preview', similarity: 0.6, lineStart: 1, lineEnd: 1 },
        { filePath: 'public/index.html', preview: 'frontend only', similarity: 0.99, lineStart: 1, lineEnd: 1 },
      ],
      attribute: (p) => attributeIndexPath(p, backend),
    })
    expect(ranked.map((c) => c.path)).toEqual(['src/App.tsx', 'src/server.ts', 'supabase/functions/api.ts'])
    expect(ranked.find((c) => c.path === 'src/App.tsx')?.previews).toEqual([])
    expect(ranked.find((c) => c.path === 'supabase/functions/api.ts')?.previews.map((p) => p.text)).toEqual(['backend preview'])
  })

  it('uses an unattributable path only if the target repo has it, and shows the target\'s bytes', async () => {
    const ranked = rankContextCandidates({
      literalHits: new Map(),
      framePaths: [],
      rag: [
        { filePath: 'src/App.tsx', preview: 'frontend preview text', similarity: 0.9, lineStart: 1, lineEnd: 1 },
        { filePath: 'src/index.ts', preview: 'frontend index preview', similarity: 0.8, lineStart: 1, lineEnd: 1 },
      ],
      attribute: (p) => attributeIndexPath(p, backend),
    })
    const readFile = vi.fn(async (path: string): Promise<BaseFileState> =>
      path === 'src/index.ts' ? { kind: 'exists', contents: 'export const backend = true\n' } : { kind: 'absent' },
    )
    const ctx = await buildFullFileContext(ranked, readFile)
    expect(readFile.mock.calls.map((c) => c[0])).toEqual(['src/App.tsx', 'src/index.ts'])
    expect(ctx.outcomes).toEqual([
      { path: 'src/App.tsx', shown: 'omitted', reason: 'not found on the base branch' },
      { path: 'src/index.ts', shown: 'full' },
    ])
    expect(ctx.text).toContain('export const backend = true')
    expect(ctx.text).not.toContain('frontend')

    // Unreadable (or no GitHub access): no preview fallback for an unknown owner.
    const blind = await buildFullFileContext(ranked, async () => ({ kind: 'unreadable', detail: '403' }))
    expect(blind.shownCount).toBe(0)
    expect(blind.text).not.toContain('frontend')
  })
})

const cand = (path: string, extra: Partial<ContextCandidate> = {}): ContextCandidate => ({
  path,
  literals: [],
  inStack: false,
  ragSimilarity: 0.8,
  previews: [],
  ...extra,
})

const fileOf = (lines: number, prefix = 'line') =>
  Array.from({ length: lines }, (_, i) => `${prefix} ${i + 1}`).join('\n') + '\n'

describe('buildFullFileContext', () => {
  it('shows whole files with a line-number gutter and reads them at the injected ref', async () => {
    const readFile = vi.fn(async (path: string): Promise<BaseFileState> => ({
      kind: 'exists',
      contents: path === 'src/a.ts' ? "const a = 1\nlog.error('fetch_patterns_failed')\n" : fileOf(3),
    }))
    const ctx = await buildFullFileContext(
      [cand('src/a.ts', { literals: ['fetch_patterns_failed'] }), cand('src/b.ts', { inStack: true })],
      readFile,
    )
    expect(readFile).toHaveBeenCalledTimes(2)
    expect(ctx.text).toContain('--- src/a.ts (full file, 2 lines; contains `fetch_patterns_failed`) ---')
    expect(ctx.text).toContain("1 | const a = 1\n2 | log.error('fetch_patterns_failed')")
    expect(ctx.text).toContain('--- src/b.ts (full file, 3 lines; in the stack trace) ---')
    expect(ctx.shownCount).toBe(2)
    expect(ctx.states.get('src/a.ts')?.kind).toBe('exists')
  })

  it('reads at most maxFiles and lists the rest as cut by the file cap', async () => {
    const readFile = vi.fn(async (): Promise<BaseFileState> => ({ kind: 'exists', contents: 'x\n' }))
    const ctx = await buildFullFileContext(
      Array.from({ length: 10 }, (_, i) => cand(`f${i}.ts`)),
      readFile,
      { maxFiles: 8 },
    )
    expect(readFile).toHaveBeenCalledTimes(8)
    expect(ctx.outcomes.filter((o) => o.shown === 'full')).toHaveLength(8)
    expect(ctx.outcomes.filter((o) => o.reason === 'over the 8-file cap').map((o) => o.path)).toEqual(['f8.ts', 'f9.ts'])
    expect(ctx.text).toContain('Not shown: f8.ts (over the 8-file cap); f9.ts (over the 8-file cap).')
  })

  it('labels a preview fallback with its line count when the full file cannot be read', async () => {
    const ctx = await buildFullFileContext(
      [cand('src/locked.ts', { previews: [{ text: 'function a() {\n  return 1\n}', lineStart: 10, lineEnd: 12 }] })],
      async () => ({ kind: 'unreadable', detail: 'GitHub contents API returned 403' }),
    )
    expect(ctx.text).toContain('--- src/locked.ts (preview only, 3 lines; full file unavailable: GitHub contents API returned 403. This is NOT the whole file')
    expect(ctx.text).toContain('10 | function a() {')
    expect(ctx.text).not.toContain('(full file')
    expect(ctx.outcomes[0]).toMatchObject({ shown: 'preview' })
  })

  it('falls back to previews, labelled, when there is no GitHub access at all', async () => {
    const ctx = await buildFullFileContext([cand('src/a.ts', { previews: [{ text: 'x\ny', lineStart: null, lineEnd: null }] })], null)
    expect(ctx.text).toMatch(/\(preview only, 2 lines; full file unavailable: no GitHub access/)
  })

  it('applies the per-file cap: an oversized file becomes an excerpt around the literal', async () => {
    const big = `${fileOf(2000)}throw new Error('ota:manifest-504')\n${fileOf(2000, 'tail')}`
    const ctx = await buildFullFileContext(
      [cand('src/huge.ts', { literals: ['ota:manifest-504'] })],
      async () => ({ kind: 'exists', contents: big }),
      { maxFileBytes: 20_000, excerptRadius: 2 },
    )
    expect(ctx.outcomes[0]).toMatchObject({ shown: 'excerpt' })
    expect(ctx.text).toMatch(/\(excerpt only, lines 1999-2003 of 4001; file is \d+ KB, over the 20 KB per-file cap; contains `ota:manifest-504`/)
    expect(ctx.text).toContain("2001 | throw new Error('ota:manifest-504')")
    expect(ctx.text).not.toContain('(full file')
  })

  it('applies the total cap: files past it fall back to their labelled preview', async () => {
    const thirty = 'y'.repeat(30_000)
    const ctx = await buildFullFileContext(
      [cand('a.ts'), cand('b.ts'), cand('c.ts', { previews: [{ text: 'preview of c', lineStart: 1, lineEnd: 1 }] })],
      async () => ({ kind: 'exists', contents: thirty }),
      { maxTotalBytes: 70_000 },
    )
    expect(ctx.outcomes.map((o) => o.shown)).toEqual(['full', 'full', 'preview'])
    expect(ctx.text).toContain('--- c.ts (preview only, 1 lines; the 70 KB total context cap was reached.')
  })

  it('drops a path the base branch does not have, and a search hit without the literal', async () => {
    const ctx = await buildFullFileContext(
      [
        cand('src/stale.ts', { previews: [{ text: 'old', lineStart: 1, lineEnd: 1 }] }),
        cand('src/false-hit.ts', { literals: ['fetch_patterns_failed'], ragSimilarity: null }),
        cand('src/real.ts'),
      ],
      async (path) =>
        path === 'src/stale.ts'
          ? { kind: 'absent' }
          : { kind: 'exists', contents: path === 'src/false-hit.ts' ? 'fetch patterns failed\n' : 'ok\n' },
    )
    expect(ctx.outcomes).toEqual([
      { path: 'src/stale.ts', shown: 'omitted', reason: 'not found on the base branch' },
      { path: 'src/false-hit.ts', shown: 'omitted', reason: 'search hit does not contain the literal' },
      { path: 'src/real.ts', shown: 'full' },
    ])
    expect(ctx.text).not.toContain('--- src/stale.ts')
    expect(ctx.shownCount).toBe(1)
  })

  it('treats a throwing reader as unreadable, not as a crash', async () => {
    const ctx = await buildFullFileContext([cand('a.ts')], async () => {
      throw new Error('network down')
    })
    expect(ctx.outcomes[0]).toMatchObject({ shown: 'omitted' })
    expect(ctx.states.get('a.ts')).toMatchObject({ kind: 'unreadable' })
  })
})

describe('i18n hop (the-wanting-mind 08d0ecde)', () => {
  const common = JSON.stringify({ readOnApp: 'Read on the app', reader: { nudge: { title: 'Read on the app today' } }, appStore: 'App Store' })

  it('recognises translation files', () => {
    expect(isLocaleFile('src/locales/en/common.json')).toBe(true)
    expect(isLocaleFile('public/i18n/ja.json')).toBe(true)
    expect(isLocaleFile('package.json')).toBe(false)
    expect(isLocaleFile('src/locales/index.ts')).toBe(false)
  })

  it('finds the keys that hold the quoted text, flat and nested', () => {
    expect(localeKeysForText(common, 'Read on the app')).toEqual(['readOnApp', 'reader.nudge.title', 'title'])
    expect(localeKeysForText(common, 'nowhere')).toEqual([])
    expect(localeKeysForText('not json', 'Read on the app')).toEqual([])
  })

  it('extracts the quoted on-screen text from the report as a literal', () => {
    const { literals } = extractReportLiterals({
      description: 'On desktop the "Read on the app" card and the audio player bar cover the first paragraphs.',
    } as never)
    expect(literals).toContain('Read on the app')
  })
})
