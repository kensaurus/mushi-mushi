/**
 * Design drift burn-down (2026-10-22):
 *   - token-definition files (theme-tokens.css, base-and-density.css,
 *     vizTokens.ts, tokens.ts, …) are never read by the literal scan, a
 *     recipe can replace the list (`design.literalScan.tokenDefinitions`, an
 *     empty list scans them again), and the auto-fix never sends a pushed
 *     finding in one of them;
 *   - dispatchExistingDesignFindings sends the NEWEST scan's existing
 *     findings to the agent, one report per file, a few files per call,
 *     skipping token-definition files, info findings, findings without a file
 *     and files that already have an open report, through the automatic
 *     (capped) dispatch.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'
import type { DevianceFinding } from '../../supabase/functions/_shared/design-engine-types.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => { throw new Error('no real db') } }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let actions: typeof import('../../supabase/functions/_shared/design-actions.ts')
let scan: typeof import('../../supabase/functions/_shared/design-scan.ts')
let schema: typeof import('../../supabase/functions/_shared/recipe-schema.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  actions = await import('../../supabase/functions/_shared/design-actions.ts')
  scan = await import('../../supabase/functions/_shared/design-scan.ts')
  schema = await import('../../supabase/functions/_shared/recipe-schema.ts')
})

const P = '1000000a-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-22T12:00:00Z')

function finding(over: Partial<DevianceFinding> = {}): DevianceFinding {
  return { rule_id: 'off_token_color', severity: 'warn', file_path: 'src/a.tsx', line: 3, col: 9, value: '#ff0000', message: 'Colour #ff0000 is not in your tokens.', suggestion: { token: 'color.cta', cssVar: '--color-cta', ts: null, value: '#C8372D', distance: 12 }, ...over }
}

const TOKEN_FILES = [
  'apps/admin/src/styles/theme-tokens.css',
  'apps/admin/src/styles/base-and-density.css',
  'apps/admin/src/lib/vizTokens.ts',
  'apps/admin/src/lib/tokens.ts',
]

describe('token-definition files', () => {
  it('the default list matches the four mushi-mushi console files and not ordinary sources', () => {
    for (const f of TOKEN_FILES) expect(scan.isTokenDefinitionFile(f, null), f).toBe(true)
    expect(scan.isTokenDefinitionFile('tokens.ts', null)).toBe(true)
    expect(scan.isTokenDefinitionFile('packages/x/brand.tokens.json', null)).toBe(true)
    for (const f of ['apps/admin/src/styles/ask-mushi.css', 'apps/admin/src/components/ui/brandMarks.ts', 'src/my-tokens.ts', 'src/tokensHelper.ts']) {
      expect(scan.isTokenDefinitionFile(f, null), f).toBe(false)
    }
    expect(scan.isTokenDefinitionFile(null, null)).toBe(false)
  })

  it('the literal scan never selects them; a recipe list replaces the defaults and an empty list scans them again', () => {
    const entries = [...TOKEN_FILES, 'apps/admin/src/pages/LoginPage.tsx', 'apps/admin/src/styles/ask-mushi.css'].map((path) => ({ path, size: 100 }))
    expect(scan.selectScanFiles(entries, null, []).files).toEqual(['apps/admin/src/pages/LoginPage.tsx', 'apps/admin/src/styles/ask-mushi.css'])
    const own = { design: { literalScan: { tokenDefinitions: ['**/ask-mushi.css'] } } }
    expect(scan.selectScanFiles(entries, own, []).files).toEqual([...TOKEN_FILES, 'apps/admin/src/pages/LoginPage.tsx'].sort())
    const none = { design: { literalScan: { tokenDefinitions: [] as string[] } } }
    expect(scan.selectScanFiles(entries, none, []).files).toHaveLength(entries.length)
  })

  it('the recipe schema accepts design.literalScan.tokenDefinitions', () => {
    const parsed = schema.parseRecipeManifest(JSON.stringify({ version: 1, design: { literalScan: { tokenDefinitions: ['**/palette.ts'] } } }))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(scan.tokenDefinitionGlobs(parsed.manifest as never)).toEqual(['**/palette.ts'])
  })
})

describe('groupFindingsByFile', () => {
  it('one group per file, most errors then most findings first, skipping token files, info, no-file and open files', () => {
    const { groups, skipped } = actions.groupFindingsByFile(
      [
        finding({ file_path: 'src/b.tsx', line: 9 }),
        finding({ file_path: 'src/b.tsx', line: 2 }),
        finding({ file_path: 'src/c.tsx', severity: 'error' }),
        finding({ file_path: 'src/a.tsx' }),
        finding({ file_path: 'apps/admin/src/styles/theme-tokens.css' }),
        finding({ file_path: 'src/d.tsx', severity: 'info', rule_id: 'off_scale_spacing' }),
        finding({ file_path: null, rule_id: 'contrast_below_aa' }),
        finding({ file_path: 'src/open.tsx' }),
      ],
      { manifest: null, openFiles: new Set(['src/open.tsx']) },
    )
    expect(groups.map((g) => g.file)).toEqual(['src/c.tsx', 'src/b.tsx', 'src/a.tsx'])
    expect(groups[1].findings.map((f) => f.line)).toEqual([2, 9])
    expect(skipped).toEqual({ tokenDefinition: 1, noFile: 1, info: 1, alreadyOpen: 1 })
  })

  it('clamps the files per call to 1..20 with a default of 5', () => {
    expect(actions.clampDispatchFiles(undefined)).toBe(5)
    expect(actions.clampDispatchFiles(0)).toBe(1)
    expect(actions.clampDispatchFiles(500)).toBe(20)
    expect(actions.clampDispatchFiles(3.7)).toBe(3)
  })

  it('the per-file report names each value with its token and forbids touching token files', () => {
    const t = actions.fileDriftReportText({ file: 'src/b.tsx', errors: 0, findings: [finding({ line: 4 }), finding({ line: 7, suggestion: null, message: 'Colour #00ff00 is not in your tokens.' })] })
    expect(t.summary).toBe('Design drift in src/b.tsx: 2 values off the design system')
    expect(t.description).toContain('- line 4 — Colour #ff0000 is not in your tokens. Use --color-cta (#C8372D).')
    expect(t.description).toContain('- line 7 — Colour #00ff00 is not in your tokens.')
    expect(t.description).toMatch(/Change only this file/)
    expect(t.description).toMatch(/Do not edit token-definition files/)
  })
})

describe('actOnDesignDeviance and token-definition files', () => {
  it('never dispatches a pushed finding in a token-definition file (an older CLI may still send one)', async () => {
    const d = makeFakeDb({
      project_settings: [{ project_id: P, design_deviance_threshold: 20, design_drift_autofix: true, autofix_enabled: true }],
      gate_runs: [{ id: 'run-prev', project_id: P, gate: 'design_drift', status: 'warn', summary: { phase: 'scan' }, started_at: '2026-10-21T12:00:00Z' }],
      gate_findings: [],
      reports: [],
    } as never, { autoId: true })
    const dispatch = vi.fn(async () => ({ ok: true, dispatchId: 'job-1' }))
    const out = await actions.actOnDesignDeviance(
      d,
      { projectId: P, runId: 'run-now', score: 60, branch: 'main', findings: [finding({ file_path: 'apps/admin/src/lib/vizTokens.ts' })] },
      null,
      { dispatch: dispatch as never, now: () => NOW },
    )
    expect(out).toEqual({ action: 'no_new_findings' })
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('dispatchExistingDesignFindings', () => {
  const run = (id: string, startedAt: string, phase = 'scan', status = 'warn') => ({ id, project_id: P, gate: 'design_drift', status, summary: { phase }, started_at: startedAt })
  const row = (runId: string, file: string | null, over: Record<string, unknown> = {}) => ({
    id: `${runId}-${file}-${Math.random()}`, gate_run_id: runId, project_id: P, severity: 'warn', rule_id: 'off_token_color', message: 'Colour #ff0000 is not in your tokens.',
    file_path: file, line: 3, col: 1, allowlisted: false, suggested_fix: { value: '#ff0000', suggestion: null }, ...over,
  })

  function seed(extra: Record<string, unknown[]> = {}): FakeDb {
    return makeFakeDb({
      project_settings: [{ project_id: P, autofix_enabled: true }],
      gate_runs: [run('old', '2026-10-20T00:00:00Z'), run('new', '2026-10-21T00:00:00Z'), run('pr', '2026-10-22T00:00:00Z', 'ci_branch_scan')],
      gate_findings: [
        row('old', 'src/only-old.tsx'),
        row('new', 'src/a.tsx'),
        row('new', 'src/a.tsx', { line: 9 }),
        row('new', 'src/b.tsx', { severity: 'error' }),
        row('new', 'src/c.tsx'),
        row('new', 'src/allowed.tsx', { allowlisted: true }),
        row('new', 'apps/admin/src/styles/theme-tokens.css'),
        row('new', 'apps/admin/src/lib/tokens.ts'),
        row('new', 'src/open.tsx'),
        row('new', 'src/info.tsx', { severity: 'info' }),
      ],
      reports: [{ id: 'r-open', project_id: P, status: 'classified', reporter_token_hash: actions.DESIGN_FILE_REPORTER, environment: { file: 'src/open.tsx' } }],
      ...extra,
    } as never, { autoId: true })
  }

  it('sends the newest scan only, one report per file, at most maxFiles, through the automatic path', async () => {
    const d = seed()
    const dispatch = vi.fn(async () => ({ ok: true, dispatchId: 'job-x' }))
    const out = await actions.dispatchExistingDesignFindings(d, { projectId: P, maxFiles: 2, requestedBy: 'user-a' }, { dispatch: dispatch as never, now: () => NOW })
    expect(out).toMatchObject({ action: 'dispatched', runId: 'new', remainingFiles: 1, skipped: { tokenDefinition: 2, info: 1, alreadyOpen: 1, noFile: 0 } })
    if (out.action !== 'dispatched') throw new Error('expected dispatched')
    expect(out.sent.map((s) => [s.file, s.findings])).toEqual([['src/b.tsx', 1], ['src/a.tsx', 2]])
    const created = d.table('reports').filter((r) => r.id !== 'r-open')
    expect(created).toHaveLength(2)
    expect(created[0]).toMatchObject({ project_id: P, reporter_token_hash: actions.DESIGN_FILE_REPORTER, severity: 'medium', environment: { file: 'src/b.tsx', gateRunId: 'new' } })
    expect(created[1]).toMatchObject({ severity: 'low', environment: { file: 'src/a.tsx' } })
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ projectId: P, trigger: 'automatic', skipMembershipCheck: true, requestedBy: 'user-a' }))

    // The next call skips the files that now have an open report.
    const again = await actions.dispatchExistingDesignFindings(d, { projectId: P, maxFiles: 5 }, { dispatch: dispatch as never, now: () => NOW })
    if (again.action !== 'dispatched') throw new Error('expected dispatched')
    expect(again.sent.map((s) => s.file)).toEqual(['src/c.tsx'])
    expect(again.remainingFiles).toBe(0)
    const third = await actions.dispatchExistingDesignFindings(d, { projectId: P }, { dispatch: dispatch as never, now: () => NOW })
    expect(third).toMatchObject({ action: 'nothing_to_send', sent: [], remainingFiles: 0 })
  })

  it('a recipe list replaces the default token-definition files', async () => {
    const d = seed()
    const dispatch = vi.fn(async () => ({ ok: true, dispatchId: 'job-x' }))
    const out = await actions.dispatchExistingDesignFindings(
      d,
      { projectId: P, maxFiles: 20, manifest: { design: { literalScan: { tokenDefinitions: ['**/theme-tokens.css'] } } } },
      { dispatch: dispatch as never, now: () => NOW },
    )
    if (out.action !== 'dispatched') throw new Error('expected dispatched')
    expect(out.sent.map((s) => s.file)).toContain('apps/admin/src/lib/tokens.ts')
    expect(out.sent.map((s) => s.file)).not.toContain('apps/admin/src/styles/theme-tokens.css')
  })

  it('records a refused dispatch and stops when auto-fix was turned off in between', async () => {
    const d = seed()
    const refuse = vi.fn(async () => ({ ok: false, code: 'AUTOFIX_DISABLED' as const, message: 'Enable Autofix in project settings first' }))
    const out = await actions.dispatchExistingDesignFindings(d, { projectId: P, maxFiles: 5 }, { dispatch: refuse as never, now: () => NOW })
    if (out.action !== 'dispatched') throw new Error('expected dispatched')
    expect(out.sent).toHaveLength(1)
    expect(out.sent[0].refused).toEqual({ code: 'AUTOFIX_DISABLED', message: 'Enable Autofix in project settings first' })
    expect(refuse).toHaveBeenCalledTimes(1)
  })

  it('does nothing without auto-fix on or without a scan, and reports a failed read as an outcome', async () => {
    const dispatch = vi.fn()
    const off = seed({ project_settings: [{ project_id: P, autofix_enabled: false }] })
    expect(await actions.dispatchExistingDesignFindings(off, { projectId: P }, { dispatch: dispatch as never, now: () => NOW })).toEqual({ action: 'autofix_disabled' })
    expect(off.table('reports')).toHaveLength(1)
    const empty = seed({ gate_runs: [run('pr', '2026-10-22T00:00:00Z', 'ci_branch_scan'), run('err', '2026-10-22T01:00:00Z', 'scan', 'error')] })
    expect(await actions.dispatchExistingDesignFindings(empty, { projectId: P }, { dispatch: dispatch as never, now: () => NOW })).toEqual({ action: 'no_scan' })
    expect(dispatch).not.toHaveBeenCalled()
  })
})
