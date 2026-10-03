/**
 * _shared/design-actions.ts — what a deviance score may do on its own:
 * the CI gate (off by default, a null score never fails) and the design-drift
 * auto-fix (off by default, above the threshold only, only for warn/error
 * findings the previous scan did not have, through dispatchFixForReport with
 * trigger 'automatic' so the auto-fix caps apply, one reused report per
 * project, and every failure reported instead of swallowed).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'
import type { DevianceFinding } from '../../supabase/functions/_shared/design-engine-types.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => { throw new Error('no real db') } }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let actions: typeof import('../../supabase/functions/_shared/design-actions.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  actions = await import('../../supabase/functions/_shared/design-actions.ts')
})

const P = '1000000a-0000-4000-8000-000000000000'
const NOW = new Date('2026-10-03T12:00:00Z')

function finding(over: Partial<DevianceFinding> = {}): DevianceFinding {
  return { rule_id: 'off_token_color', severity: 'warn', file_path: 'src/a.tsx', line: 3, col: 9, value: '#ff0000', message: 'Colour #ff0000 is not in your tokens.', suggestion: { token: 'color.cta', cssVar: '--color-cta', ts: null, value: '#C8372D', distance: 12 }, ...over }
}

const ON = { project_id: P, design_deviance_threshold: 20, design_deviance_fail_ci: true, design_drift_autofix: true, autofix_enabled: true }
const prevRun = { id: 'run-prev', project_id: P, gate: 'design_drift', status: 'warn', summary: { phase: 'scan' }, started_at: '2026-10-02T12:00:00Z' }
const prevFinding = { gate_run_id: 'run-prev', rule_id: 'off_token_color', file_path: 'src/a.tsx', line: 1, suggested_fix: { value: '#ff0000' } }

function db(extra: Record<string, unknown[]> = {}): FakeDb {
  return makeFakeDb({ project_settings: [ON], gate_runs: [prevRun], gate_findings: [prevFinding], reports: [], ...extra } as never, { autoId: true })
}

const dispatched = vi.fn(async () => ({ ok: true, dispatchId: 'job-1', status: 'queued' }))
const deps = (dispatch = dispatched) => ({ dispatch: dispatch as never, now: () => NOW })

describe('devianceGate', () => {
  it('is off unless the project turned it on, and a null score never fails', () => {
    expect(actions.devianceGate(null, 90)).toEqual({ enabled: false, failAbove: null, exceeded: false })
    const s = { threshold: 30, failCi: true, autofix: false, autofixEnabled: false }
    expect(actions.devianceGate({ ...s, failCi: false }, 90).exceeded).toBe(false)
    expect(actions.devianceGate(s, 31)).toEqual({ enabled: true, failAbove: 30, exceeded: true })
    expect(actions.devianceGate(s, 30).exceeded).toBe(false)
    expect(actions.devianceGate(s, null).exceeded).toBe(false)
  })
})

describe('newFindings', () => {
  it('keys on rule, file and value (not line), skips info and duplicates', () => {
    const cur = [
      finding({ line: 40 }), // moved, not new
      finding({ value: '#00ff00' }),
      finding({ value: '#00ff00', line: 9 }), // same key twice
      finding({ rule_id: 'off_scale_spacing', severity: 'info', value: '13px' }),
    ]
    expect(actions.newFindings(cur, [{ rule_id: 'off_token_color', file_path: 'src/a.tsx', value: '#ff0000' }]).map((f) => f.value)).toEqual(['#00ff00'])
  })
})

describe('driftReportText', () => {
  it('names each new value with the token to use', () => {
    const t = actions.driftReportText([finding({ value: '#00ff00', message: 'Colour #00ff00 is not in your tokens.' })], 42, 'main')
    expect(t.summary).toBe('Design drift: 1 new value off the design system (score 42/100)')
    expect(t.description).toContain('- src/a.tsx:3 — Colour #00ff00 is not in your tokens. Use --color-cta (#C8372D).')
    expect(t.description).toContain('of main')
  })
})

describe('actOnDesignDeviance', () => {
  const input = (over: Partial<{ score: number | null; findings: DevianceFinding[] }> = {}) => ({ projectId: P, runId: 'run-now', score: 55, findings: [finding({ value: '#00ff00', message: 'Colour #00ff00 is not in your tokens.' })], branch: 'main', ...over })

  it('does nothing while the auto-fix is off (the default) or the score is at or under the threshold', async () => {
    const d1 = db({ project_settings: [{ project_id: P }] })
    expect(await actions.actOnDesignDeviance(d1, input(), null, deps())).toEqual({ action: 'off' })
    expect(await actions.actOnDesignDeviance(db(), input({ score: 20 }), null, deps())).toEqual({ action: 'below_threshold' })
    expect(await actions.actOnDesignDeviance(db(), input({ score: null }), null, deps())).toEqual({ action: 'below_threshold' })
    expect(dispatched).not.toHaveBeenCalled()
  })

  it('says so when the project auto-fix switch is off, instead of a silent no-op', async () => {
    const d = db({ project_settings: [{ ...ON, autofix_enabled: false }] })
    expect(await actions.actOnDesignDeviance(d, input(), null, deps())).toEqual({ action: 'autofix_disabled' })
    expect(d.table('reports')).toHaveLength(0)
  })

  it('treats a first scan as the baseline and a scan with nothing new as nothing to do', async () => {
    expect(await actions.actOnDesignDeviance(db({ gate_runs: [], gate_findings: [] }), input(), null, deps())).toEqual({ action: 'baseline' })
    expect(await actions.actOnDesignDeviance(db(), input({ findings: [finding()] }), null, deps())).toEqual({ action: 'no_new_findings' })
  })

  it('opens one design-drift report and dispatches through the automatic (capped) path', async () => {
    const d = db()
    const dispatch = vi.fn(async () => ({ ok: true, dispatchId: 'job-1', status: 'queued' }))
    const out = await actions.actOnDesignDeviance(d, input(), null, deps(dispatch as never))
    expect(out).toMatchObject({ action: 'dispatched', dispatchId: 'job-1', newFindings: 1 })
    const [report] = d.table('reports')
    expect(report).toMatchObject({ project_id: P, category: 'visual', source: 'api', status: 'classified', reporter_token_hash: 'cron:design-drift', severity: 'low' })
    expect(String(report.description)).toContain('#00ff00')
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ projectId: P, reportId: report.id, trigger: 'automatic', skipMembershipCheck: true }))

    // The next scan with another new value reuses the open report.
    const again = await actions.actOnDesignDeviance(d, { ...input(), runId: 'run-later', findings: [finding({ value: '#0000ff', severity: 'error' })] }, null, deps(dispatch as never))
    expect(again).toMatchObject({ action: 'dispatched', reportId: report.id })
    expect(d.table('reports')).toHaveLength(1)
    expect(d.table('reports')[0]).toMatchObject({ severity: 'medium' })
  })

  it('finds the previous scan however many PR pushes and refresh errors came after it', async () => {
    const noise = Array.from({ length: 40 }, (_, i) => ({
      id: `noise-${i}`, project_id: P, gate: 'design_drift', status: i % 2 ? 'pass' : 'error',
      summary: { phase: i % 2 ? 'ci_branch_scan' : 'refresh' }, started_at: `2026-10-03T0${Math.floor(i / 10)}:${String(i % 60).padStart(2, '0')}:00Z`,
    }))
    const d = db({ gate_runs: [prevRun, ...noise] })
    const out = await actions.actOnDesignDeviance(d, input(), null, deps())
    expect(out).toMatchObject({ action: 'dispatched', newFindings: 1 })
  })

  it('acts only on the findings a scan stores, so a finding past the cap is never new on every scan', async () => {
    const stored = Array.from({ length: 500 }, (_, i) => finding({ severity: 'error', value: `#0000${String(i).padStart(2, '0').slice(-2)}`, file_path: `src/e${String(i).padStart(3, '0')}.tsx` }))
    const prevRows = stored.map((f) => ({ gate_run_id: 'run-prev', rule_id: f.rule_id, severity: f.severity, file_path: f.file_path, suggested_fix: { value: f.value } }))
    const d = db({ gate_runs: [{ ...prevRun, findings_count: 500, summary: { phase: 'scan', storedFindings: 500 } }], gate_findings: prevRows })
    // The 501st (a warn, sorted after every error) is past the cap: not stored, so not acted on.
    const past = finding({ value: '#abcdef', file_path: 'src/z.tsx' })
    expect(await actions.actOnDesignDeviance(d, input({ findings: [...stored, past] }), null, deps())).toEqual({ action: 'no_new_findings' })
  })

  it('a previous scan that stored only part of its findings judges new only in the buckets it stored completely', async () => {
    const prev = { ...prevRun, findings_count: 900, summary: { phase: 'scan', storedFindings: 1 } }
    const prevRow = { gate_run_id: 'run-prev', rule_id: 'off_token_color', severity: 'warn', file_path: 'src/a.tsx', suggested_fix: { value: '#ff0000' } }
    const d = db({ gate_runs: [prev], gate_findings: [prevRow] })
    const out = await actions.actOnDesignDeviance(d, input({
      findings: [
        finding({ severity: 'error', value: '#111111', file_path: 'src/z.tsx' }), // error sorts before the last stored (warn) bucket: complete, so new
        finding({ value: '#222222', file_path: 'src/a.tsx' }), // the last stored bucket may have been cut: not new
        finding({ value: '#333333', file_path: 'src/b.tsx' }), // past the cut: not new
      ],
    }), null, deps())
    expect(out).toMatchObject({ action: 'dispatched', newFindings: 1 })
    expect(String(d.table('reports')[0].description)).toContain('src/z.tsx')
    expect(String(d.table('reports')[0].description)).not.toContain('src/b.tsx')
    expect(actions.storedBoundary([{ severity: 'warn', file_path: 'src/a.tsx' }, { severity: 'error', file_path: 'src/z.tsx' }])).toEqual({ severity: 'warn', file: 'src/a.tsx' })
  })

  it('opens a new report once the old one is fixed', async () => {
    const d = db({ reports: [{ id: 'r-old', project_id: P, reporter_token_hash: 'cron:design-drift', status: 'fixed', created_at: '2026-10-01T00:00:00Z' }] })
    const out = await actions.actOnDesignDeviance(d, input(), null, deps())
    expect(out.action).toBe('dispatched')
    expect(d.table('reports')).toHaveLength(2)
  })

  it('returns a refused dispatch (caps, in-flight dedupe) and failed reads as outcomes', async () => {
    const refuse = vi.fn(async () => ({ ok: false, code: 'ALREADY_DISPATCHED' as const, message: 'A fix dispatch is already in progress for this report' }))
    expect(await actions.actOnDesignDeviance(db(), input(), null, deps(refuse as never))).toMatchObject({ action: 'dispatch_refused', code: 'ALREADY_DISPATCHED' })
    expect(await actions.actOnDesignDeviance(db(), input(), { ok: false, error: 'column "design_drift_autofix" does not exist' }, deps())).toEqual({ action: 'settings_unavailable', error: 'column "design_drift_autofix" does not exist' })
    const broken = db()
    const from = broken.from.bind(broken)
    broken.from = ((t: string) => (t === 'gate_findings' ? { select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: 'boom' } }) }) }) } : from(t))) as never
    expect(await actions.actOnDesignDeviance(broken, input(), null, deps())).toEqual({ action: 'report_failed', error: 'gate_findings read failed: boom' })
  })
})
