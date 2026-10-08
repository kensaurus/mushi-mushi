/**
 * `mushi audit` re-runs stale inventory gates (POST /v1/admin/projects/:id/audit).
 *
 * Until 2026-10-07 the audit asked "did any gate run today?" using the newest
 * run of ANY gate. radar and portfolio_radar run daily, so the answer was
 * always yes and crawl / status_claim / api_contract stayed stale from May.
 * planAuditGateRefresh decides per gate, and says why it skips each one.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.mock('../../supabase/functions/_shared/db.ts', () => ({
  getServiceClient: () => {
    throw new Error('real getServiceClient must not be used in tests')
  },
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  adminOrApiKey: () => async (_c: unknown, next: () => Promise<void>) => next(),
  keyGrantsAnyScope: (scopes: string[], accepted: string[]) => accepted.some((s) => scopes.includes(s)),
  jwtAuth: async (_c: unknown, next: () => Promise<void>) => next(),
}))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/supabase-mcp-client.ts', () => ({
  resolveSupabasePat: vi.fn(),
  getSupabaseAdvisors: vi.fn(),
  getLogs: vi.fn(),
  listTables: vi.fn(),
}))

let audit: typeof import('../../supabase/functions/api/routes/fullstack-audit.ts')

beforeAll(async () => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => process.env[k] } }
  audit = await import('../../supabase/functions/api/routes/fullstack-audit.ts')
})

const NOW = Date.parse('2026-10-07T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
const run = (h: number) => ({ started_at: hoursAgo(h), completed_at: hoursAgo(h) })

const base = {
  canWrite: true,
  inventory: 'current' as const,
  entitled: true,
  crawlUrl: { url: 'https://kensaur.us/glot-it', skipped: [] },
  envReady: true,
  nowMs: NOW,
}

describe('planAuditGateRefresh', () => {
  it('re-runs the inventory gates even when radar ran today (the glot.it case)', () => {
    const latestByGate = new Map([
      ['radar', run(1)],
      ['portfolio_radar', run(8)],
      ['design_drift', run(30)],
    ])
    const plan = audit.planAuditGateRefresh({ ...base, latestByGate })
    expect(plan.crawl).toBe(true)
    expect(plan.gates).toEqual(['status_claim', 'api_contract', 'orphan_endpoint', 'unknown_call'])
    expect(plan.skipped).toEqual([])
  })

  it('skips only the gates that ran within a day, and says when', () => {
    const latestByGate = new Map([
      ['crawl', run(30)],
      ['status_claim', run(3)],
      ['api_contract', { started_at: hoursAgo(1), completed_at: null }],
    ])
    const plan = audit.planAuditGateRefresh({ ...base, latestByGate })
    expect(plan.crawl).toBe(true)
    expect(plan.gates).toEqual(['orphan_endpoint', 'unknown_call'])
    expect(plan.skipped).toEqual([
      { gate: 'status_claim', reason: 'Ran 3 h ago; re-runs once a day.' },
      { gate: 'api_contract', reason: 'Ran 1 h ago; re-runs once a day.' },
    ])
  })

  it('skips the crawl with the reason when no URL is crawlable', () => {
    const plan = audit.planAuditGateRefresh({
      ...base,
      latestByGate: new Map(),
      crawlUrl: { url: null, skipped: ['preview_url http://localhost:3000 is not https'] },
    })
    expect(plan.crawl).toBe(false)
    expect(plan.gates).toHaveLength(4)
    expect(plan.skipped).toEqual([
      {
        gate: 'crawl',
        reason: 'No crawlable URL: set crawler_base_url in project settings (preview_url http://localhost:3000 is not https).',
      },
    ])
  })

  it.each([
    [{ latestByGate: null }, /could not be read, so whether this gate is stale is unknown/],
    // A read-only key (mcp:read) may audit, but not start runs: the crawl sends crawler_auth_config.
    [{ canWrite: false }, /read-only access \(a key without mcp:write, or a viewer\)/],
    [{ entitled: false }, /plan does not include inventory checks/],
    [{ inventory: 'none' as const }, /No current inventory/],
    [{ inventory: 'unknown' as const }, /inventory could not be read/],
    [{ envReady: false }, /no SUPABASE_URL or service key/],
  ])('skips every gate, with a reason, when %o', (override, reason) => {
    const plan = audit.planAuditGateRefresh({ ...base, latestByGate: new Map(), ...override })
    expect(plan.crawl).toBe(false)
    expect(plan.gates).toEqual([])
    expect(plan.skipped).toHaveLength(5)
    for (const s of plan.skipped) expect(s.reason).toMatch(reason)
  })
})

describe('audit route wiring', () => {
  const src = readFileSync(
    resolve(__dirname, '../../supabase/functions/api/routes/fullstack-audit.ts'),
    'utf-8',
  )

  it('no longer keys freshness on the newest run of any gate', () => {
    expect(src).not.toMatch(/runs\[0\]\?\.completed_at/)
    expect(src).toMatch(/latestByGate: gateRead\.ok \? gateRead\.latestByGate : null/)
  })

  it('returns the refresh decision and uses the Inventory routes’ rate limiters', () => {
    expect(src).toMatch(/gate_refresh: gateRefresh/)
    expect(src).toMatch(/reconcileRateLimiter\.consume\(`\$\{projectId\}:reconcile`\)/)
    expect(src).toMatch(/gatesRunRateLimiter\.consume\(`\$\{projectId\}:gates\.run`\)/)
    expect(src).toMatch(/invoke\('inventory-crawler'/)
    expect(src).toMatch(/invoke\('inventory-gates', \{ gates: decision\.gates \}\)/)
  })

  it('applies the Inventory write rule: mcp:write for keys, no viewers', () => {
    expect(src).toMatch(/keyGrantsAnyScope\(c\.get\('apiKeyScopes'\) \?\? \[\], \['mcp:write'\]\)/)
    expect(src).toMatch(/project\.organization_role !== 'viewer'/)
  })
})
