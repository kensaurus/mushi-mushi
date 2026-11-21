/**
 * FILE: packages/server/src/__tests__/ux-scorecard.test.ts
 * PURPOSE: The UX scorecard's pure rules (ADR 0067):
 *            - the server module is the CLI's, byte for byte;
 *            - a page's identity keeps its view (`/team?view=sso`), not its records;
 *            - a model answer is read strictly: eight scores, evidence, a fix, no taste;
 *            - measured facts cap performance and accessibility, and the overall
 *              score follows the worst dimension;
 *            - issues on many pages group into one root cause, a reworded cause
 *              keeps its earlier pattern key, and the cross-page pass merges in;
 *            - a run files one report per root cause, at most five, and never
 *              a second report for an open pattern.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  accessibilityCap,
  causeReportBody,
  evidenceSeenIn,
  groupCauses,
  groupingPrompt,
  mergeGrouping,
  overallScore,
  pageSystemPrompt,
  pageUserPrompt,
  parsePageAnswer,
  patternKeyFor,
  performanceCap,
  planFiling,
  sameCause,
  scorecardMarkdown,
  scorecardPageKey,
  scorecardRows,
  UX_DIMENSIONS,
  UX_RUBRIC,
  UX_SCORE_ANCHORS,
  UX_SCORECARD_LIMITS,
  UX_SCORECARD_PROMPT_VERSION,
  type ScoredPage,
  type UxCause,
  type UxDimension,
  type UxPageFacts,
} from '../../supabase/functions/_shared/ux-scorecard.ts'

const facts = (over: Partial<UxPageFacts> = {}): UxPageFacts => ({
  key: '/queue',
  path: '/queue',
  label: 'Processing jobs',
  title: 'Processing jobs · Mushi',
  headings: ['Processing jobs'],
  text: 'Oldest pending job is 34865m old. Waiting 579h 57m. Stage 1 failed: 500 {"ok":false}',
  controls: ['Recover stranded jobs', 'Dead letter'],
  settleMs: 1200,
  axe: { critical: 0, serious: 0, rules: [] },
  overflowX: false,
  consoleErrors: 0,
  cls: 0,
  viewport: { width: 1440, height: 900 },
  ...over,
})

const allScores = (n: number, over: Partial<Record<UxDimension, number>> = {}) =>
  Object.fromEntries(UX_DIMENSIONS.map((d) => [d, { score: over[d] ?? n, why: `${d} reason` }]))

const answer = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    page: 'The queue of report processing jobs',
    scores: allScores(6, { copy: 2 }),
    issues: [
      {
        dimension: 'copy',
        severity: 'high',
        title: 'Durations shown in raw minutes',
        problem: 'The oldest job reads "34865m old", which nobody can read at a glance.',
        evidence: '"Oldest pending job is 34865m old"',
        fix: 'Format durations with the relative-time helper ("24 days").',
        cause: 'duration formatting helper',
        confidence: 0.9,
      },
    ],
    claims: [{ subject: 'Stranded jobs', value: '12 waiting' }],
    ...over,
  })

describe('one module on both sides', () => {
  it('the CLI copy is the server module, byte for byte', () => {
    const srv = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/ux-scorecard.ts'), 'utf8')
    const cli = readFileSync(resolve(__dirname, '../../../ux/src/scorecard-rubric.ts'), 'utf8')
    expect(cli).toBe(srv)
  })
})

describe('page identity', () => {
  it('keeps view-like params, sorted, and drops record params and the hash', () => {
    expect(scorecardPageKey('/team?view=sso')).toBe('/team?view=sso')
    expect(scorecardPageKey('/team?project=abc&view=billing#top')).toBe('/team?view=billing')
    expect(scorecardPageKey('/settings/?tab=byok&view=x')).toBe('/settings?tab=byok&view=x')
    expect(scorecardPageKey('/reports?q=crash&page=2')).toBe('/reports')
    expect(scorecardPageKey('/')).toBe('/')
  })
})

describe('reading a page answer', () => {
  it('reads eight scores, the issue and the claims, and computes the overall from them', () => {
    const r = parsePageAnswer(answer(), facts())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.scores.copy).toBe(2)
    expect(r.value.issues).toHaveLength(1)
    expect(r.value.issues[0].evidenceSeen).toBe(true)
    expect(r.value.claims).toEqual([{ subject: 'Stranded jobs', value: '12 waiting' }])
    // mean 5.5, min 2 → 0.5·5.5 + 0.5·2 = 3.75 → 4
    expect(r.value.overall).toBe(4)
  })

  it('refuses an answer that skips a dimension, and one with no JSON', () => {
    const scores = allScores(7) as Record<string, unknown>
    delete scores.truthfulness
    expect(parsePageAnswer(answer({ scores }), facts())).toEqual({ ok: false, error: 'The answer has no score for truthfulness.' })
    expect(parsePageAnswer('I think it is fine', facts()).ok).toBe(false)
  })

  it('clamps scores to whole numbers 1–10 and reads a bare number too', () => {
    const r = parsePageAnswer(answer({ scores: { ...allScores(7), clarity: 14, hierarchy: { score: 0.2 } } }), facts())
    expect(r.ok && r.value.scores.clarity).toBe(10)
    expect(r.ok && r.value.scores.hierarchy).toBe(1)
  })

  it('drops taste notes, unknown dimensions, low confidence and issues without evidence or a fix', () => {
    const base = { dimension: 'copy', severity: 'medium', title: 'T', problem: 'A real visible problem here', evidence: '"Dead letter"', fix: 'Rename it to Failed jobs', confidence: 0.8 }
    const r = parsePageAnswer(
      answer({
        issues: [
          { ...base, problem: 'The header could be nicer with more air' },
          { ...base, dimension: 'vibes' },
          { ...base, confidence: 0.3 },
          { ...base, evidence: '' },
          { ...base, fix: '' },
          { ...base, severity: 'critical' },
          base,
        ],
      }),
      facts(),
    )
    expect(r.ok && r.value.issues.map((i) => i.title)).toEqual(['T'])
  })

  it('keeps at most five issues and twelve claims', () => {
    const issue = { dimension: 'copy', severity: 'low', title: 'x', problem: 'A real visible problem here', evidence: 'Dead letter', fix: 'Rename the label', confidence: 0.8 }
    const r = parsePageAnswer(answer({ issues: Array(9).fill(issue), claims: Array(20).fill({ subject: 'a', value: 'b' }) }), facts())
    expect(r.ok && r.value.issues).toHaveLength(UX_SCORECARD_LIMITS.issues)
    expect(r.ok && r.value.claims).toHaveLength(UX_SCORECARD_LIMITS.claims)
  })

  it('marks evidence the page does not contain', () => {
    const f = facts()
    expect(evidenceSeenIn('“Waiting 579h 57m”', f)).toBe(true)
    expect(evidenceSeenIn('The toast covers the last table row', f)).toBe(false)
    expect(evidenceSeenIn('"Recover stranded jobs" … "Dead letter"', f)).toBe(true)
  })
})

describe('facts cap the scores', () => {
  it('the settle time caps performance', () => {
    expect(performanceCap(900)).toBe(10)
    expect(performanceCap(2500)).toBe(8)
    expect(performanceCap(4000)).toBe(6)
    expect(performanceCap(7600)).toBe(4)
    expect(performanceCap(12_000)).toBe(3)
    expect(performanceCap(null)).toBe(4)
  })

  it('axe failures and a sideways scroll cap accessibility', () => {
    expect(accessibilityCap({ axe: { critical: 0, serious: 0, rules: [] }, overflowX: false })).toBe(10)
    expect(accessibilityCap({ axe: { critical: 0, serious: 4, rules: [] }, overflowX: false })).toBe(6)
    expect(accessibilityCap({ axe: { critical: 1, serious: 0, rules: [] }, overflowX: false })).toBe(5)
    expect(accessibilityCap({ axe: { critical: 0, serious: 0, rules: [] }, overflowX: true })).toBe(6)
  })

  it('a slow page cannot score 9 on performance, and the model number is kept', () => {
    const r = parsePageAnswer(answer({ scores: allScores(9) }), facts({ settleMs: 7000 }))
    expect(r.ok && r.value.scores.performance).toBe(4)
    expect(r.ok && r.value.capped).toEqual({ performance: 9 })
  })

  it('one terrible dimension drags the overall down more than an average would', () => {
    const s = (n: number, low: number) => Object.fromEntries(UX_DIMENSIONS.map((d, i) => [d, i === 0 ? low : n])) as Record<UxDimension, number>
    expect(overallScore(s(8, 8))).toBe(8)
    expect(overallScore(s(7, 2))).toBe(4)
    expect(overallScore(s(6, 3))).toBe(4)
    expect(overallScore(s(9, 1))).toBe(5)
  })
})

describe('prompts', () => {
  it('names every dimension and the anchors, and fences page text as data', () => {
    const sys = pageSystemPrompt()
    for (const d of UX_DIMENSIONS) expect(sys).toContain(`- ${d} (`)
    expect(sys).toContain('1–2: the page is broken')
    const user = pageUserPrompt(facts({ earlyText: 'Checking…' }), { app: 'Mushi', otherPages: ['Home', 'Bugs'], images: ['early.png', 'settled.png'] })
    expect(user).toContain('Browser tab title: "Processing jobs · Mushi"')
    expect(user).toContain('<page-text-early-in-load>\nChecking…')
    expect(user).toContain('early.png and settled.png')
    expect(user).toContain("The app's other pages: Home | Bugs")
  })
})

// ── Grouping ───────────────────────────────────────────────────────────────

const issue = (title: string, cause: string, evidence: string, dimension: UxDimension = 'copy', severity: 'high' | 'medium' | 'low' = 'medium') => ({
  dimension,
  severity,
  title,
  problem: `${title} is a visible problem`,
  evidence,
  fix: `Fix ${title}`,
  cause,
  confidence: 0.8,
  evidenceSeen: true,
})

const page = (key: string, label: string, issues: ReturnType<typeof issue>[], overall = 5, claims: Array<{ subject: string; value: string }> = []): ScoredPage => ({
  key,
  label,
  score: {
    key,
    page: label,
    scores: Object.fromEntries(UX_DIMENSIONS.map((d) => [d, overall])) as Record<UxDimension, number>,
    why: {},
    capped: {},
    overall,
    issues,
    claims,
    promptVersion: 'test',
  },
})

const pages = [
  page('/help', 'Help', [issue('Scope bar on a team page', 'projectScope registry', 'This page shows one app at a time', 'truthfulness')]),
  page('/plugins', 'Plugins', [issue('One-app bar shown on an account page', 'project scope registry', 'This page shows one app at a time: lets-talk', 'truthfulness')]),
  page('/team?view=billing', 'Billing', [issue('App scope bar on billing', '', 'This page shows one app at a time', 'truthfulness'), issue('Money with 4 decimals', 'money formatting', '$0.4029')]),
  page('/queue', 'Processing jobs', [issue('Raw minutes', 'duration formatting', '34865m old', 'copy', 'high')], 3),
]

describe('root causes across pages', () => {
  it('joins issues whose cause names the same shared thing, or that quote the same evidence', () => {
    const causes = groupCauses(pages)
    const scope = causes.find((c) => c.dimension === 'truthfulness')!
    expect(scope.pages.map((p) => p.key).sort()).toEqual(['/help', '/plugins', '/team?view=billing'])
    expect(scope.kind).toBe('shared')
    expect(causes.filter((c) => c.kind === 'page').map((c) => c.title).sort()).toEqual(['Money with 4 decimals', 'Raw minutes'])
  })

  it('a shared cause ranks above a one-page cause of the same severity', () => {
    const causes = groupCauses(pages)
    expect(causes[0].dimension).toBe('truthfulness')
  })

  it('reuses an earlier open key for a reworded cause in the same dimension, never across dimensions', () => {
    expect(sameCause('projectScope registry', 'project scope registry entries')).toBe(true)
    expect(patternKeyFor('truthfulness', 'projectScope registry', ['ux:truthfulness:scope-registry'])).toBe('ux:truthfulness:scope-registry')
    expect(patternKeyFor('truthfulness', 'the project scope registry', ['ux:truthfulness:project-scope-registry'])).toBe('ux:truthfulness:project-scope-registry')
    expect(patternKeyFor('copy', 'project scope registry', ['ux:truthfulness:project-scope-registry'])).toBe('ux:copy:project-scope-registry')
  })

  it('the cross-page pass lists issue ids and claims, and asks for reuse of earlier keys', () => {
    const p = groupingPrompt([page('/checks', 'Checks', [], 4, [{ subject: 'Scheduled tests', value: 'Not run yet' }]), ...pages], ['ux:copy:duration-formatting'])
    expect(p.user).toContain('P0 Checks (/checks) score 4')
    expect(p.user).toContain('claims: Scheduled tests = Not run yet')
    expect(p.user).toContain('P4.I0 [copy/high] Raw minutes')
    expect(p.system).toContain('ux:copy:duration-formatting')
  })

  it('merges model causes over the code groups and keeps a contradiction that cites pages only', () => {
    const all = [page('/checks', 'Checks', [], 4, [{ subject: 'Scheduled tests', value: 'Not run yet' }]), page('/qa', 'Scheduled tests', [], 8, [{ subject: 'Scheduled tests', value: '7 of 7 passing' }]), ...pages]
    const base = groupCauses(all)
    const merged = mergeGrouping(all, base, {
      causes: [
        { kind: 'contradiction', dimension: 'truthfulness', severity: 'high', title: 'Checks says scheduled tests never ran', root: 'checkCardStatus', problem: 'Two pages disagree', fix: 'Map pending runs to the last result', pages: ['P0', 'P1'], evidence: ['Scheduled tests = Not run yet'], confidence: 0.85 },
        { kind: 'shared', dimension: 'copy', severity: 'medium', title: 'Raw machine values', root: 'value formatting helpers', fix: 'Use the shared formatters', issue_ids: ['P4.I1', 'P5.I0'], confidence: 0.8 },
        { kind: 'shared', dimension: 'copy', severity: 'low', title: 'Bad ids', fix: 'Fix them all', issue_ids: ['P9.I9'] },
      ],
    })
    const contra = merged.find((c) => c.kind === 'contradiction')!
    expect(contra.pages.map((p) => p.key)).toEqual(['/checks', '/qa'])
    expect(contra.patternKey).toBe('ux:truthfulness:check-card-status')
    expect(contra.evidenceSeen).toBe(true)
    const raw = merged.find((c) => c.title.startsWith('Raw machine values'))!
    expect(raw.pages.map((p) => p.key).sort()).toEqual(['/queue', '/team?view=billing'])
    // The two issues it took left their one-page groups.
    expect(merged.some((c) => c.title === 'Raw minutes')).toBe(false)
    expect(merged.some((c) => c.title === 'Money with 4 decimals')).toBe(false)
    // The invented id was ignored; the scope cause stayed.
    expect(merged.some((c) => c.dimension === 'truthfulness' && c.kind === 'shared')).toBe(true)
  })
})

describe('filing', () => {
  const cause = (key: string, over: Partial<UxCause> = {}): UxCause => ({
    patternKey: key,
    dimension: 'copy',
    severity: 'medium',
    kind: 'shared',
    title: key,
    problem: 'A real problem',
    fix: 'A real fix',
    pages: [
      { key: '/a', label: 'A', issueTitle: 't', evidence: 'e' },
      { key: '/b', label: 'B', issueTitle: 't', evidence: 'e' },
    ],
    confidence: 0.8,
    evidenceSeen: true,
    ...over,
  })

  it('files one report per cause, at most five, and refreshes an open pattern instead of filing it again', () => {
    const causes = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'].map((k) => cause(`ux:copy:${k}`))
    const plan = planFiling(causes, ['ux:copy:k2'])
    expect(plan.file).toHaveLength(5)
    expect(plan.update.map((c) => c.patternKey)).toEqual(['ux:copy:k2'])
    expect(plan.overCap).toHaveLength(1)
  })

  it('never files a one-page cause unless it is high, nor one without evidence seen or under the confidence floor', () => {
    const one = { pages: [{ key: '/a', label: 'A', issueTitle: 't', evidence: 'e' }], kind: 'page' as const }
    const plan = planFiling(
      [
        cause('ux:copy:page-medium', one),
        cause('ux:copy:page-high', { ...one, severity: 'high' }),
        cause('ux:copy:unseen', { evidenceSeen: false, confidence: 0.7 }),
        cause('ux:copy:unseen-sure', { evidenceSeen: false, confidence: 0.9 }),
        cause('ux:copy:unsure', { confidence: 0.55 }),
      ],
      [],
    )
    expect(plan.file.map((c) => c.patternKey).sort()).toEqual(['ux:copy:page-high', 'ux:copy:unseen-sure'])
  })

  it('the report names every page with its score, the fix, and the marker', () => {
    const body = causeReportBody(cause('ux:truthfulness:project-scope', { dimension: 'truthfulness', title: 'Scope bar on team pages' }), { baseUrl: 'https://kensaur.us/mushi-mushi/admin/', runId: '20261121-120000-abcd', pageScores: { '/a': 5 } })
    expect(body.title).toBe('Scope bar on team pages (2 pages)')
    expect(body.description).toContain('- A (/a), page score 5/10: e')
    expect(body.description).toContain('Fix: A real fix')
    expect(body.description).toContain('mushi-ux-scorecard:ux:truthfulness:project-scope')
    expect(body.description).not.toMatch(/\n\n\n/)
  })
})

describe('the scorecard', () => {
  it('lists pages worst first with the trend from earlier runs', () => {
    const rows = scorecardRows(pages, [
      { key: '/queue', overall: 2, at: '2026-11-01' },
      { key: '/queue', overall: 4, at: '2026-11-10' },
    ])
    expect(rows[0].key).toBe('/queue')
    expect(rows[0].history).toEqual([2, 4])
    expect(rows[0].delta).toBe(-1)
    expect(rows[1].delta).toBeNull()
  })

  it('renders cross-cutting causes and pages as Markdown', () => {
    const md = scorecardMarkdown({ app: 'Mushi', url: 'https://x/admin', at: '2026-11-21', viewport: { width: 1440, height: 900 }, rows: scorecardRows(pages), causes: groupCauses(pages) })
    expect(md).toContain('## Cross-cutting problems (root causes)')
    expect(md).toContain('| C1 |')
    expect(md).toContain('### 3 · Processing jobs (`/queue`)')
  })
})

// ── Wire shapes and rows (ux-scorecard-io.ts) ─────────────────────────────

describe('rows and wire shapes', () => {
  it('a page key becomes a short surface key and its screenshots a fixed path', async () => {
    const io = await import('../../supabase/functions/_shared/ux-scorecard-io.ts')
    expect(io.scorecardSurfaceKey('/team?view=sso')).toBe('team-view-sso')
    expect(io.scorecardSurfaceKey('/')).toBe('root')
    expect(io.scorecardSurfaceKey(`/${'a'.repeat(300)}`).length).toBeLessThanOrEqual(120)
    expect(io.scorecardShotPath('p', 'r', 'team-view-sso/settled.png')).toBe('p/r/scorecard/team-view-sso/settled.png')
    expect(io.scorecardShotPath('p', 'r', '../x/settled.png')).toBeNull()
    expect(io.scorecardShotPath('p', 'r', 'team/other.png')).toBeNull()
    expect(io.parseViewport('1440x900')).toEqual({ width: 1440, height: 900 })
    expect(io.parseViewport('99x900')).toBeNull()
  })

  it('a snapshot parses, and its run and page rows carry the score and the counts', async () => {
    const io = await import('../../supabase/functions/_shared/ux-scorecard-io.ts')
    const r = parsePageAnswer(answer(), facts())
    if (!r.ok) throw new Error(r.error)
    const snap = io.UxScorecardSnapshot.parse({
      status: 'done',
      start_url: 'https://kensaur.us/mushi-mushi/admin/',
      viewport: '1440x900',
      scored_by: 'claude-code:claude-sonnet-5-5',
      started_at: '2026-11-21T10:00:00Z',
      pages: [{ facts: facts(), score: r.value, shots: ['queue/settled.png'] }, { facts: facts({ key: '/x', path: '/x' }), error: 'Not captured: timeout' }],
    })
    const now = new Date('2026-11-21T10:30:00Z')
    const run = io.scorecardRunRow(snap, { projectId: 'p', localRunId: '20261121-100000-abcd', userId: 'u', now })
    expect(run).toMatchObject({ kind: 'scorecard', agent: 'ux-scorecard', detail: 'viewport 1440x900', counts: { pages: 2, scored: 1, failed: 1, mean: 4 } })
    const scored = io.scorecardSurfaceRow(snap.pages[0], { projectId: 'p', runRowId: 'run', now })
    expect(scored).toMatchObject({ surface_key: 'queue', path: '/queue', status: 'baseline', score: 4, thumbs: { scorecard: ['queue/settled.png'] } })
    const failed = io.scorecardSurfaceRow(snap.pages[1], { projectId: 'p', runRowId: 'run', now })
    expect(failed).toMatchObject({ status: 'blocked', note: 'Not captured: timeout' })
    expect('score' in failed).toBe(false)
    expect(io.scoredPageFromRow({ path: '/queue', label: 'Processing jobs', scorecard: scored.scorecard, facts: scored.facts })?.score.overall).toBe(4)
    expect(io.scoredPageFromRow({ path: '/x', label: 'X', scorecard: null, facts: null })).toBeNull()
  })

  it('a root cause files as a ux_scorecard report with its pattern key and screens', async () => {
    const io = await import('../../supabase/functions/_shared/ux-scorecard-io.ts')
    const c = groupCauses(pages)[0]
    const row = io.scorecardReportRow(c, { reportId: 'r', projectId: 'p', actorId: 'u', localRunId: '20261121-100000-abcd', baseUrl: 'https://x/admin/', pageScores: { '/help': 5 }, now: new Date('2026-11-21T10:30:00Z') })
    expect(row).toMatchObject({ source: 'ux_scorecard', status: 'new', pattern_key: c.patternKey, category: 'visual', reporter_token_hash: 'ux-scorecard' })
    expect((row.affected_screens as Array<{ file: string }>).map((s) => s.file).sort()).toEqual(['/help', '/plugins', '/team?view=billing'])
    expect(io.UxScorecardCauses.safeParse([c]).success).toBe(true)
  })
})

describe('the versioned rubric file', () => {
  it('docs/ux-scorecard-rubric.md carries the current version, every dimension, every anchor and the system prompt verbatim', () => {
    const doc = readFileSync(resolve(__dirname, '../../../../docs/ux-scorecard-rubric.md'), 'utf8')
    expect(doc).toContain(`Version: \`${UX_SCORECARD_PROMPT_VERSION}\``)
    for (const d of UX_DIMENSIONS) expect(doc).toContain(`- **${d}** (${UX_RUBRIC[d].label}): ${UX_RUBRIC[d].asks}`)
    for (const a of UX_SCORE_ANCHORS) expect(doc).toContain(`- ${a}`)
    expect(doc).toContain(pageSystemPrompt())
  })
})
