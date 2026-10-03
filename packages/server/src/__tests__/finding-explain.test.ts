/**
 * explain_finding (gap #24): GET /v1/admin/findings/:findingId and the pure
 * explainFinding / fixOf helpers. One finding by id: the check, why it fired,
 * where, the fix in one sentence, and whether the latest run of the same
 * check still reports it. A read failure must not read as "fixed".
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => { throw new Error('no real db') } }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  apiKeyAuth: async (_c: unknown, next: () => Promise<void>) => next(),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))

let helper: typeof import('../../supabase/functions/_shared/finding-explain.ts')
let routes: typeof import('../../supabase/functions/api/routes/finding-explain.ts')
beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  helper = await import('../../supabase/functions/_shared/finding-explain.ts')
  routes = await import('../../supabase/functions/api/routes/finding-explain.ts')
})

const P1 = '1000000a-0000-4000-8000-000000000000'
const P2 = '1000000b-0000-4000-8000-000000000000'
const RUN_OLD = '2000000a-0000-4000-8000-000000000000'
const RUN_NEW = '2000000b-0000-4000-8000-000000000000'
const F_OLD = '3000000a-0000-4000-8000-000000000000'
const F_NEW = '3000000b-0000-4000-8000-000000000000'
const F_OTHER = '3000000c-0000-4000-8000-000000000000'

function finding(over: Record<string, unknown> = {}) {
  return {
    id: F_OLD, gate_run_id: RUN_OLD, project_id: P1, severity: 'error', rule_id: 'god_file', message: 'src/app.tsx is 2,400 lines.',
    file_path: 'src/app.tsx', line: 1, col: null, node_id: null, suggested_fix: { text: 'Split the routes out of src/app.tsx.' },
    allowlisted: false, allowlist_reason: null, created_at: '2026-10-01T00:00:00Z', ...over,
  }
}
const run = (over: Record<string, unknown> = {}) => ({
  id: RUN_OLD, gate: 'code_health', status: 'fail', started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:01:00Z', commit_sha: 'abc1234', ...over,
})

describe('fixOf reads every stored fix shape', () => {
  it('reads radar, recipe drift, setup and inventory fixes', () => {
    expect(helper.fixOf({ fix: 'Renew the domain.', target: 'example.com' }).text).toBe('Renew the domain.')
    expect(helper.fixOf({ kind: 'patch', text: 'timeout-minutes: 15' })).toMatchObject({ text: 'timeout-minutes: 15', kind: 'patch' })
    expect(helper.fixOf({ kind: 'setup', step: 'Reconnect Linear.' }).text).toBe('Reconnect Linear.')
    expect(helper.fixOf({ explanation: 'Declare it in inventory.yaml.', route: '/api/x' }).text).toBe('Declare it in inventory.yaml.')
  })
  it('turns a design deviance into the token to use', () => {
    const fix = helper.fixOf({ value: '#ff0000', suggestion: { token: 'color.danger', cssVar: '--color-danger', value: '#f00', distance: 1 } })
    expect(fix.text).toBe('Replace `#ff0000` with the design token color.danger (var(--color-danger)).')
  })
  it('turns console steps and commands into one sentence, keeping the raw object', () => {
    const consoleFix = helper.fixOf({ kind: 'console', path: '/settings?tab=general', values: { autofix_max_spend_usd: 25 } })
    expect(consoleFix).toMatchObject({ consolePath: '/settings?tab=general', text: 'Open /settings?tab=general in the Mushi console and set autofix_max_spend_usd = 25.' })
    expect(consoleFix.detail).toEqual({ kind: 'console', path: '/settings?tab=general', values: { autofix_max_spend_usd: 25 } })
    expect(helper.fixOf({ kind: 'command', command: 'mushi index', console_path: '/explore?tab=index' })).toMatchObject({ text: 'Run `mushi index`.', command: 'mushi index', consolePath: '/explore?tab=index' })
    expect(helper.fixOf({ kind: 'setting', field: 'project_repos.default_branch', value: 'main' }).text).toBe('Set project_repos.default_branch to main.')
  })
  it('returns no text, never a guess, for an unknown or empty fix', () => {
    expect(helper.fixOf(null)).toEqual({ text: null, kind: null, consolePath: null, command: null, detail: null })
    expect(helper.fixOf({ method: 'GET', path: '/v1/x' }).text).toBeNull()
  })
})

describe('absenceUnproven: a missing finding is evidence only from a clean, complete run', () => {
  const base = { status: 'pass', findingsCount: 0, storedCount: null, summary: null, ruleId: 'god_file', matchedBy: 'file' as const }
  it('accepts a complete run that was searched by file or target', () => {
    expect(helper.absenceUnproven(base)).toBeNull()
    expect(helper.absenceUnproven({ ...base, matchedBy: 'target' })).toBeNull()
    expect(helper.absenceUnproven({ ...base, status: 'fail', findingsCount: 2, storedCount: 2 })).toBeNull()
  })
  it('refuses an errored or skipped run', () => {
    expect(helper.absenceUnproven({ ...base, status: 'error' })).toContain('"error"')
    expect(helper.absenceUnproven({ ...base, status: 'skipped' })).toContain('"skipped"')
  })
  it('refuses a run that stored fewer findings than it found', () => {
    expect(helper.absenceUnproven({ ...base, status: 'warn', findingsCount: 250, storedCount: 200 })).toContain('stored only 200')
    expect(helper.absenceUnproven({ ...base, status: 'warn', findingsCount: 3, storedCount: null })).not.toBeNull()
  })
  it('accepts a per-rule summary only when the rule ran to the end (ok, or finding with others)', () => {
    const summary = (state: string) => ({ results: [{ ruleId: 'domain_expiring', state, reason: 'registry did not answer', findings: 0 }] })
    const radar = { ...base, ruleId: 'domain_expiring', matchedBy: 'target' as const }
    expect(helper.absenceUnproven({ ...radar, summary: summary('ok') })).toBeNull()
    // The rule ran and found other targets; this one is not among them.
    expect(helper.absenceUnproven({ ...radar, status: 'warn', findingsCount: 1, storedCount: 1, summary: summary('finding') })).toBeNull()
    for (const state of ['unknown', 'error']) {
      expect(helper.absenceUnproven({ ...radar, summary: summary(state) }), state).toContain(`"${state}"`)
    }
    expect(helper.absenceUnproven({ ...radar, summary: { results: [{ ruleId: 'cert_expiring', state: 'ok' }] } })).toContain('did not run the domain_expiring rule')
  })
  it('lets a rule checked clean outweigh a run that errored on another connector', () => {
    const radar = { ...base, ruleId: 'domain_expiring', matchedBy: 'target' as const }
    const summary = { results: [{ ruleId: 'domain_expiring', state: 'ok' }, { ruleId: 'store_listing', state: 'error' }] }
    expect(helper.absenceUnproven({ ...radar, status: 'error', summary })).toBeNull()
    // ...but never a run whose findings did not land (radar marks that run error too).
    expect(helper.absenceUnproven({ ...radar, status: 'error', findingsCount: 2, storedCount: 0, summary })).toContain('stored only 0')
  })
  it('refuses a run that read only part of the project', () => {
    expect(helper.absenceUnproven({ ...base, summary: { phase: 'scan', truncated: true } })).toContain('file limit')
    expect(helper.absenceUnproven({ ...base, summary: { phase: 'ci_scan', scannedFiles: 0 } })).toContain('read no files')
    expect(helper.absenceUnproven({ ...base, status: 'warn', findingsCount: 500, storedCount: 500, summary: { phase: 'ci_scan', scannedFiles: 90 } })).toContain('500')
    expect(helper.absenceUnproven({ ...base, summary: { phase: 'scan', truncated: false, scannedFiles: 40 } })).toBeNull()
  })
  it('refuses a run that recorded findings it could not store', () => {
    expect(helper.absenceUnproven({ ...base, status: 'fail', findingsCount: 2, storedCount: 2, summary: { violations: 3, findings_not_stored: 1 } })).toContain('could not store 1')
  })
  it('scopes runs: design phases, and inventory story subtrees', () => {
    expect(helper.designRunPhase({ phase: 'ci_scan' })).toBe('ci_scan')
    expect(helper.designRunPhase({ phase: 'scan' })).toBe('scan')
    expect(helper.designRunPhase(null)).toBe('scan')
    expect(helper.runStoryScope({ story_node_id: 'story-a' })).toBe('story-a')
    expect(helper.runStoryScope({ actions_examined: 3 })).toBeNull()
    expect(helper.runCoversScope(null, null)).toBe(true)
    expect(helper.runCoversScope('story-a', null)).toBe(true)
    expect(helper.runCoversScope('story-a', 'story-a')).toBe(true)
    expect(helper.runCoversScope(null, 'story-a')).toBe(false)
    expect(helper.runCoversScope('story-a', 'story-b')).toBe(false)
  })
  it('refuses a message-only search', () => {
    expect(helper.absenceUnproven({ ...base, matchedBy: 'message' })).toContain('message')
  })
})

describe('findingTargetKey', () => {
  it('reads target, then route, then a non-console path', () => {
    expect(helper.findingTargetKey({ fix: 'Renew it.', target: 'example.com' })).toEqual({ key: 'target', value: 'example.com' })
    expect(helper.findingTargetKey({ explanation: 'x', route: '/api/x' })).toEqual({ key: 'route', value: '/api/x' })
    expect(helper.findingTargetKey({ method: 'GET', path: '/v1/x' })).toEqual({ key: 'path', value: '/v1/x' })
    expect(helper.findingTargetKey({ kind: 'console', path: '/settings' })).toBeNull()
    expect(helper.findingTargetKey({ fix: 'x', target: null })).toBeNull()
  })
})

describe('explainFinding', () => {
  it('explains a finding in the latest run as open, with the gate meaning and location', () => {
    const out = helper.explainFinding(finding(), run(), { id: RUN_OLD, completed_at: '2026-10-01T00:01:00Z', matchingFindingId: F_OLD, uncheckedReason: null })
    expect(out).toMatchObject({
      gate: 'code_health', gateLabel: 'Code health', ruleId: 'god_file', reason: 'src/app.tsx is 2,400 lines.',
      location: { filePath: 'src/app.tsx', line: 1, col: null, target: null }, state: 'open',
      fix: { text: 'Split the routes out of src/app.tsx.' }, latestRun: { id: RUN_OLD, findingId: F_OLD },
    })
    expect(out.gateMeaning.length).toBeGreaterThan(10)
  })
  it('adds the radar rule title and what it prevents', () => {
    const out = helper.explainFinding(finding({ rule_id: 'domain_expiring', file_path: null }), run({ gate: 'portfolio_radar' }), null)
    expect(out.rule?.title).toBe('Domain not about to expire')
    expect(out.rule?.prevents).toContain('domain')
  })
  it('says not_in_latest_run when a newer run no longer has it, and open when it does', () => {
    expect(helper.explainFinding(finding(), run(), { id: RUN_NEW, completed_at: null, matchingFindingId: null, uncheckedReason: null }).state).toBe('not_in_latest_run')
    expect(helper.explainFinding(finding(), run(), { id: RUN_NEW, completed_at: null, matchingFindingId: F_NEW, uncheckedReason: null })).toMatchObject({ state: 'open', latestRun: { findingId: F_NEW } })
  })
  it('says unknown, never fixed, when the newer run could not confirm it', () => {
    const out = helper.explainFinding(finding(), run(), { id: RUN_NEW, completed_at: null, matchingFindingId: null, uncheckedReason: 'the latest run ended with status "error", so it did not check everything.' })
    expect(out.state).toBe('unknown')
    expect(out.stateReason).toContain('could not confirm it is fixed')
  })
  it('reports allowlisted when the newer run still has it, allowlisted there', () => {
    const out = helper.explainFinding(finding(), run(), { id: RUN_NEW, completed_at: null, matchingFindingId: F_NEW, matchingAllowlisted: true, matchingAllowlistReason: 'vendored', uncheckedReason: null })
    expect(out).toMatchObject({ state: 'allowlisted', latestRun: { findingId: F_NEW } })
    expect(out.stateReason).toContain('vendored')
  })
  it('reports an allowlisted finding as allowlisted, with the reason', () => {
    const out = helper.explainFinding(finding({ allowlisted: true, allowlist_reason: 'generated file' }), run(), null)
    expect(out).toMatchObject({ state: 'allowlisted', stateReason: 'Allowlisted: generated file' })
  })
  it('knows a label for every gate_runs gate', () => {
    for (const gate of ['dead_handler', 'mock_leak', 'api_contract', 'crawl', 'status_claim', 'spec_drift', 'orphan_endpoint', 'unknown_call', 'schema_drift', 'code_health', 'design_drift', 'ci_drift', 'deploy_drift', 'env_drift', 'portfolio_radar', 'portfolio_radar_ci', 'store_review', 'radar']) {
      expect(helper.GATE_MEANINGS[gate], gate).toBeDefined()
    }
  })
})

type Handler = (c: unknown, next?: () => Promise<void>) => Promise<unknown> | unknown
class FakeApp {
  routes: Array<{ method: string; pattern: RegExp; keys: string[]; handlers: Handler[] }> = []
  get(path: string, ...handlers: Handler[]) {
    const keys: string[] = []
    this.routes.push({ method: 'GET', keys, handlers, pattern: new RegExp(`^${path.replace(/:(\w+)/g, (_m, k: string) => { keys.push(k); return '([^/]+)' })}$`) })
  }
  async call(url: string, vars: Record<string, unknown> = {}): Promise<{ status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } } }> {
    for (const r of this.routes) {
      const m = r.pattern.exec(url)
      if (!m) continue
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]))
      const ctxVars: Record<string, unknown> = { userId: 'owner', authMethod: 'jwt', ...vars }
      const c = {
        req: { param: (k: string) => params[k], query: () => undefined, header: () => undefined },
        get: (k: string) => ctxVars[k], set: (k: string, v: unknown) => { ctxVars[k] = v },
        json: (body: unknown, status = 200) => ({ body, status }),
      }
      return (await r.handlers[r.handlers.length - 1](c)) as { status: number; body: { ok: boolean; data?: Record<string, unknown>; error?: { code: string } } }
    }
    throw new Error(`no route GET ${url}`)
  }
}

function setup(extra: Record<string, unknown[]> = {}) {
  const db = makeFakeDb({
    projects: [{ id: P1, owner_id: 'owner', organization_id: null }, { id: P2, owner_id: 'stranger', organization_id: null }],
    organization_members: [],
    project_members: [],
    gate_runs: [
      { id: RUN_OLD, project_id: P1, gate: 'code_health', status: 'fail', started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:01:00Z', commit_sha: 'abc1234', summary: null },
    ],
    gate_findings: [finding()],
    ...extra,
  } as never)
  const app = new FakeApp()
  const pass = (async (_c: unknown, next: () => Promise<void>) => next()) as never
  routes.registerFindingExplainRoutes(app as never, { getServiceClient: () => db as never, adminOrApiKeyRead: pass })
  return { db, app }
}

describe('GET /v1/admin/findings/:findingId', () => {
  it('explains a finding of a project the caller can reach', async () => {
    const { app } = setup()
    const res = await app.call(`/v1/admin/findings/${F_OLD}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ id: F_OLD, gate: 'code_health', state: 'open', fix: { text: 'Split the routes out of src/app.tsx.' } })
  })

  it('is a 404 for another tenant, an unknown id and a non-uuid alike', async () => {
    const { app } = setup({ gate_findings: [finding(), finding({ id: F_OTHER, project_id: P2 })] })
    for (const id of [F_OTHER, '3000000f-0000-4000-8000-000000000000', 'not-a-uuid']) {
      const res = await app.call(`/v1/admin/findings/${id}`)
      expect(res.status, id).toBe(404)
      expect(res.body.error?.code).toBe('NOT_FOUND')
    }
  })

  it('refuses a project-bound key aimed at another of the owner\'s projects', async () => {
    const { app } = setup()
    const res = await app.call(`/v1/admin/findings/${F_OLD}`, { authMethod: 'apiKey', projectId: P2 })
    expect(res.status).toBe(404)
  })

  it('reports not_in_latest_run when a newer run of the same check no longer has it', async () => {
    const { app, db } = setup()
    ;(db as FakeDb).table('gate_runs').push({ id: RUN_NEW, project_id: P1, gate: 'code_health', status: 'pass', started_at: '2026-10-02T00:00:00Z', completed_at: '2026-10-02T00:01:00Z', commit_sha: 'def5678', summary: null })
    const res = await app.call(`/v1/admin/findings/${F_OLD}`)
    expect(res.body.data).toMatchObject({ state: 'not_in_latest_run', latestRun: { id: RUN_NEW, findingId: null } })
  })

  it('reports open when the newer run found the same rule in the same file', async () => {
    const { app, db } = setup()
    ;(db as FakeDb).table('gate_runs').push({ id: RUN_NEW, project_id: P1, gate: 'code_health', status: 'fail', started_at: '2026-10-02T00:00:00Z', completed_at: '2026-10-02T00:01:00Z', commit_sha: 'def5678', summary: null })
    ;(db as FakeDb).table('gate_findings').push(finding({ id: F_NEW, gate_run_id: RUN_NEW, line: 3 }))
    const res = await app.call(`/v1/admin/findings/${F_OLD}`)
    expect(res.body.data).toMatchObject({ state: 'open', latestRun: { id: RUN_NEW, findingId: F_NEW } })
  })

  it('ignores a still-running run and design token-refresh rows when picking the latest run', async () => {
    const { app, db } = setup({
      gate_runs: [
        { id: RUN_OLD, project_id: P1, gate: 'design_drift', status: 'fail', started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:01:00Z', commit_sha: 'a', summary: { phase: 'scan' } },
        { id: RUN_NEW, project_id: P1, gate: 'design_drift', status: 'pass', started_at: '2026-10-02T00:00:00Z', completed_at: '2026-10-02T00:00:05Z', commit_sha: 'b', summary: { phase: 'refresh' } },
        { id: '2000000c-0000-4000-8000-000000000000', project_id: P1, gate: 'design_drift', status: 'running', started_at: '2026-10-03T00:00:00Z', completed_at: null, commit_sha: 'c', summary: { phase: 'scan' } },
      ],
    })
    void db
    const res = await app.call(`/v1/admin/findings/${F_OLD}`)
    expect(res.body.data).toMatchObject({ gate: 'design_drift', state: 'open', latestRun: { id: RUN_OLD } })
  })

  // ── a missing finding is "fixed" only on evidence ──────────────────────────

  const RADAR_OLD_RUN = { id: RUN_OLD, project_id: P1, gate: 'portfolio_radar', status: 'warn', started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:01:00Z', commit_sha: null, findings_count: 1, summary: { results: [{ ruleId: 'domain_expiring', state: 'finding', reason: '1 problem found.', findings: 1 }] } }
  const domainFinding = (over: Record<string, unknown> = {}) => finding({
    rule_id: 'domain_expiring', severity: 'warn', file_path: null, line: null,
    message: 'example.com expires in 20 days (2026-10-21)', suggested_fix: { fix: 'Renew example.com or turn on auto-renew.', target: 'example.com', evidence: null }, ...over,
  })
  const radarNew = (over: Record<string, unknown> = {}) => ({
    id: RUN_NEW, project_id: P1, gate: 'portfolio_radar', status: 'pass', started_at: '2026-10-02T00:00:00Z', completed_at: '2026-10-02T00:01:00Z', commit_sha: null, findings_count: 0,
    summary: { results: [{ ruleId: 'domain_expiring', state: 'ok', reason: 'Every domain has more than 30 days left.', findings: 0 }] }, ...over,
  })

  it('never says fixed when the latest run errored and stored nothing', async () => {
    const { app } = setup({
      gate_runs: [RADAR_OLD_RUN, radarNew({ status: 'error', summary: { results: [], error: 'findings not stored: timeout' } })],
      gate_findings: [domainFinding()],
    })
    const res = await app.call(`/v1/admin/findings/${F_OLD}`)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ state: 'unknown', latestRun: { id: RUN_NEW, findingId: null } })
  })

  it('never says fixed when the rule was unknown in the latest radar run', async () => {
    const { app } = setup({
      gate_runs: [RADAR_OLD_RUN, radarNew({ summary: { results: [{ ruleId: 'domain_expiring', state: 'unknown', reason: 'The registry did not answer.', findings: 0 }] } })],
      gate_findings: [domainFinding()],
    })
    const res = await app.call(`/v1/admin/findings/${F_OLD}`)
    expect(res.body.data).toMatchObject({ state: 'unknown' })
    expect(String(res.body.data?.stateReason)).toContain('The registry did not answer.')
  })

  it('never says fixed when the latest run did not run the rule at all', async () => {
    const { app } = setup({
      gate_runs: [RADAR_OLD_RUN, radarNew({ summary: { results: [{ ruleId: 'cert_expiring', state: 'ok', reason: 'ok', findings: 0 }] } })],
      gate_findings: [domainFinding()],
    })
    expect((await app.call(`/v1/admin/findings/${F_OLD}`)).body.data).toMatchObject({ state: 'unknown' })
  })

  it('says fixed when the rule was checked clean and the target is gone', async () => {
    const { app } = setup({ gate_runs: [RADAR_OLD_RUN, radarNew()], gate_findings: [domainFinding()] })
    expect((await app.call(`/v1/admin/findings/${F_OLD}`)).body.data).toMatchObject({ state: 'not_in_latest_run', latestRun: { id: RUN_NEW, findingId: null } })
  })

  it('matches a file-less finding on its target, not its message with the day count', async () => {
    const { app } = setup({
      gate_runs: [RADAR_OLD_RUN, radarNew({ status: 'warn', findings_count: 1, summary: { results: [{ ruleId: 'domain_expiring', state: 'finding', reason: '1 problem found.', findings: 1 }] } })],
      gate_findings: [domainFinding(), domainFinding({ id: F_NEW, gate_run_id: RUN_NEW, message: 'example.com expires in 19 days (2026-10-21)' })],
    })
    expect((await app.call(`/v1/admin/findings/${F_OLD}`)).body.data).toMatchObject({ state: 'open', latestRun: { id: RUN_NEW, findingId: F_NEW } })
  })

  it('never says fixed when the latest run stored fewer findings than it found', async () => {
    const { app } = setup({
      gate_runs: [
        { id: RUN_OLD, project_id: P1, gate: 'code_health', status: 'fail', started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:01:00Z', commit_sha: 'a', summary: null, findings_count: 1 },
        { id: RUN_NEW, project_id: P1, gate: 'code_health', status: 'fail', started_at: '2026-10-02T00:00:00Z', completed_at: '2026-10-02T00:01:00Z', commit_sha: 'b', summary: null, findings_count: 3 },
      ],
      gate_findings: [finding(), finding({ id: F_NEW, gate_run_id: RUN_NEW, file_path: 'src/other.tsx' })],
    })
    const res = await app.call(`/v1/admin/findings/${F_OLD}`)
    expect(res.body.data).toMatchObject({ state: 'unknown' })
    expect(String(res.body.data?.stateReason)).toContain('stored only 1')
  })

  it('never says fixed for a finding with no file and no target whose message is gone', async () => {
    const { app } = setup({
      gate_runs: [
        { id: RUN_OLD, project_id: P1, gate: 'store_review', status: 'warn', started_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T00:01:00Z', commit_sha: null, summary: null, findings_count: 1 },
        { id: RUN_NEW, project_id: P1, gate: 'store_review', status: 'pass', started_at: '2026-10-02T00:00:00Z', completed_at: '2026-10-02T00:01:00Z', commit_sha: null, summary: null, findings_count: 0 },
      ],
      gate_findings: [finding({ rule_id: 'listing_length', file_path: null, line: null, message: 'The description is 4,120 of 4,000 characters.', suggested_fix: { fix: 'Shorten it.', target: null } })],
    })
    expect((await app.call(`/v1/admin/findings/${F_OLD}`)).body.data).toMatchObject({ state: 'unknown' })
  })

  it('keeps a finding open when its own run is the newest, even with status error', async () => {
    const { app } = setup({
      gate_runs: [
        { ...radarNew({ id: RUN_OLD, started_at: '2026-09-30T00:00:00Z' }) },
        { ...RADAR_OLD_RUN, id: RUN_NEW, status: 'error', started_at: '2026-10-02T00:00:00Z' },
      ],
      gate_findings: [domainFinding({ gate_run_id: RUN_NEW })],
    })
    expect((await app.call(`/v1/admin/findings/${F_OLD}`)).body.data).toMatchObject({ state: 'open', latestRun: { id: RUN_NEW, findingId: F_OLD } })
  })

  it('reports allowlisted when the newer run has it but it is allowlisted there', async () => {
    const { app, db } = setup()
    ;(db as FakeDb).table('gate_runs').push({ id: RUN_NEW, project_id: P1, gate: 'code_health', status: 'fail', started_at: '2026-10-02T00:00:00Z', completed_at: '2026-10-02T00:01:00Z', commit_sha: 'b', summary: null, findings_count: 1 })
    ;(db as FakeDb).table('gate_findings').push(finding({ id: F_NEW, gate_run_id: RUN_NEW, allowlisted: true, allowlist_reason: 'generated file' }))
    const res = await app.call(`/v1/admin/findings/${F_OLD}`)
    expect(res.body.data).toMatchObject({ state: 'allowlisted', latestRun: { findingId: F_NEW } })
  })

  // ── compare only with a run that looked at the same thing ───────────────────

  const RUN_THIRD = '2000000c-0000-4000-8000-000000000000'
  const designRun = (over: Record<string, unknown>) => ({
    project_id: P1, gate: 'design_drift', commit_sha: 'a', findings_count: 0, completed_at: '2026-10-01T00:01:00Z', ...over,
  })
  const designFinding = (over: Record<string, unknown> = {}) => finding({
    rule_id: 'spacing_literal', severity: 'warn', file_path: 'src/Button.tsx', line: 12, message: 'src/Button.tsx:12 uses 13px, which matches no spacing token.',
    suggested_fix: { value: '13px', suggestion: { token: 'space.3', cssVar: '--space-3', value: '12px', distance: 1 } }, ...over,
  })

  it('never calls a server-scan design finding fixed because a newer CI push did not report it', async () => {
    const { app } = setup({
      gate_runs: [
        designRun({ id: RUN_OLD, status: 'warn', started_at: '2026-10-01T00:00:00Z', findings_count: 1, summary: { phase: 'scan', truncated: false, scannedFiles: 400 } }),
        // `mushi recipe check --push`: only off_token_literal, only the files CI matched.
        designRun({ id: RUN_NEW, status: 'pass', started_at: '2026-10-02T00:00:00Z', triggered_by: 'ci', summary: { phase: 'ci_scan', source: 'ci', scannedFiles: 30, storedFindings: 0 } }),
      ],
      gate_findings: [designFinding()],
    })
    const res = await app.call(`/v1/admin/findings/${F_OLD}`)
    expect(res.body.data?.state).not.toBe('not_in_latest_run')
    expect(res.body.data).toMatchObject({ state: 'open', latestRun: { id: RUN_OLD } })
  })

  it('compares a CI-push design finding with the next CI push', async () => {
    const { app } = setup({
      gate_runs: [
        designRun({ id: RUN_OLD, status: 'warn', started_at: '2026-10-01T00:00:00Z', findings_count: 1, summary: { phase: 'ci_scan', scannedFiles: 30, storedFindings: 1 } }),
        designRun({ id: RUN_NEW, status: 'pass', started_at: '2026-10-02T00:00:00Z', summary: { phase: 'ci_scan', scannedFiles: 30, storedFindings: 0 } }),
        // A newer server scan is a different kind of run and is not the comparison.
        designRun({ id: RUN_THIRD, status: 'pass', started_at: '2026-10-03T00:00:00Z', summary: { phase: 'scan', truncated: false, scannedFiles: 400 } }),
      ],
      gate_findings: [designFinding({ rule_id: 'off_token_literal', message: 'src/Button.tsx:12 uses #123456, which matches no design token.', suggested_fix: null })],
    })
    expect((await app.call(`/v1/admin/findings/${F_OLD}`)).body.data).toMatchObject({ state: 'not_in_latest_run', latestRun: { id: RUN_NEW } })
  })

  it('never says fixed after a server scan that stopped at its file limit', async () => {
    const { app } = setup({
      gate_runs: [
        designRun({ id: RUN_OLD, status: 'warn', started_at: '2026-10-01T00:00:00Z', findings_count: 1, summary: { phase: 'scan', truncated: false, scannedFiles: 400 } }),
        designRun({ id: RUN_NEW, status: 'pass', started_at: '2026-10-02T00:00:00Z', summary: { phase: 'scan', truncated: true, scannedFiles: 1500 } }),
      ],
      gate_findings: [designFinding()],
    })
    const res = await app.call(`/v1/admin/findings/${F_OLD}`)
    expect(res.body.data).toMatchObject({ state: 'unknown', latestRun: { id: RUN_NEW } })
    expect(String(res.body.data?.stateReason)).toContain('file limit')
  })

  const claimRun = (over: Record<string, unknown>) => ({
    project_id: P1, gate: 'status_claim', commit_sha: null, completed_at: '2026-10-01T00:01:00Z', findings_count: 0, ...over,
  })
  const claimFinding = (over: Record<string, unknown> = {}) => finding({
    rule_id: 'status-claim-violation', file_path: null, line: null, node_id: 'node-checkout', message: 'Action "Checkout" claims verified but the reconciler derives wired.',
    suggested_fix: { explanation: 'Downgrade the claim.' }, ...over,
  })

  it('skips an inventory-gates run scoped to another story subtree', async () => {
    const { app } = setup({
      gate_runs: [
        claimRun({ id: RUN_OLD, status: 'fail', started_at: '2026-10-01T00:00:00Z', findings_count: 1, summary: { actions_examined: 40, violations: 1 } }),
        claimRun({ id: RUN_NEW, status: 'pass', started_at: '2026-10-02T00:00:00Z', summary: { actions_examined: 3, violations: 0, story_node_id: 'story-signup' } }),
      ],
      gate_findings: [claimFinding()],
    })
    const res = await app.call(`/v1/admin/findings/${F_OLD}`)
    expect(res.body.data?.state).not.toBe('not_in_latest_run')
    expect(res.body.data).toMatchObject({ state: 'open', latestRun: { id: RUN_OLD } })
  })

  it('never says fixed when the inventory-gates run could not store some findings', async () => {
    const { app } = setup({
      gate_runs: [
        claimRun({ id: RUN_OLD, status: 'fail', started_at: '2026-10-01T00:00:00Z', findings_count: 1, summary: { actions_examined: 40, violations: 1 } }),
        claimRun({ id: RUN_NEW, status: 'fail', started_at: '2026-10-02T00:00:00Z', findings_count: 0, summary: { actions_examined: 40, violations: 1, findings_not_stored: 1 } }),
      ],
      gate_findings: [claimFinding()],
    })
    expect((await app.call(`/v1/admin/findings/${F_OLD}`)).body.data).toMatchObject({ state: 'unknown' })
  })

  it('never compares a finding whose run is still going with an older finished run', async () => {
    const { app } = setup({
      gate_runs: [
        { id: RUN_OLD, project_id: P1, gate: 'code_health', status: 'pass', started_at: '2026-09-30T00:00:00Z', completed_at: '2026-09-30T00:01:00Z', commit_sha: 'a', summary: null, findings_count: 0 },
        { id: RUN_NEW, project_id: P1, gate: 'code_health', status: 'running', started_at: '2026-10-01T00:00:00Z', completed_at: null, commit_sha: 'b', summary: null, findings_count: null },
      ],
      gate_findings: [finding({ gate_run_id: RUN_NEW })],
    })
    const res = await app.call(`/v1/admin/findings/${F_OLD}`)
    expect(res.body.data?.state).not.toBe('not_in_latest_run')
    expect(res.body.data).toMatchObject({ state: 'open', latestRun: null })
  })

  it('says fixed when an errored radar run still checked this rule clean', async () => {
    const { app } = setup({
      gate_runs: [RADAR_OLD_RUN, radarNew({ status: 'error', summary: { results: [{ ruleId: 'domain_expiring', state: 'ok', reason: 'ok', findings: 0 }, { ruleId: 'store_listing', state: 'error', reason: 'connector down', findings: 0 }] } })],
      gate_findings: [domainFinding()],
    })
    expect((await app.call(`/v1/admin/findings/${F_OLD}`)).body.data).toMatchObject({ state: 'not_in_latest_run', latestRun: { id: RUN_NEW } })
  })

  it('answers 500, never "fixed", when the latest-run read fails', async () => {
    const { app, db } = setup()
    const real = (db as FakeDb).from.bind(db)
    ;(db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = real(t)
      if (t !== 'gate_runs') return q
      // The by-id run read uses maybeSingle; the latest-run list read does not.
      return new Proxy(q, {
        get(target, prop, receiver) {
          if (prop === 'not') return () => ({ order: () => ({ limit: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) })
          return Reflect.get(target, prop, receiver)
        },
      })
    }
    const res = await app.call(`/v1/admin/findings/${F_OLD}`)
    expect(res.status).toBe(500)
    expect(res.body.error?.code).toBe('DB_ERROR')
  })
})
