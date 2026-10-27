/**
 * POST /v1/webhooks/github check_run: the App webhook stores the head rollup
 * and, when that rollup is green, clears a stale ci_infra flag. The indexer
 * already did; this path did not (report 9e2ec6f0).
 */
import { createHmac } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const PROJECT = '1000000a-0000-4000-8000-000000000000'
const ATTEMPT = '3000000a-0000-4000-8000-000000000000'
const SHA = 'b'.repeat(40)
const SECRET = 'whsec'

const rollup = vi.hoisted(() => ({ status: 'completed', conclusion: 'success' as string }))

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => db }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/auth.ts', () => {
  const pass = async (_c: unknown, next: () => Promise<void>) => { await next() }
  return { jwtAuth: pass, apiKeyAuth: pass, adminOrApiKey: () => pass }
})
vi.mock('../../supabase/functions/_shared/webhook-middleware.ts', () => {
  class ReplayAttackError extends Error {}
  class RateLimitError extends Error {}
  return {
    createWebhookMiddleware: () => ({
      audit: async () => ({ id: 'audit-1', resolve: async () => {}, setProject: async () => {} }),
      checkReplay: async () => {},
      checkRateLimit: () => {},
    }),
    ReplayAttackError,
    RateLimitError,
  }
})
vi.mock('../../supabase/functions/api/routes/cli-auth.ts', () => ({
  claimIpRateLimit: async () => null,
  extractClientIp: () => '203.0.113.1',
}))
vi.mock('../../supabase/functions/_shared/github.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../supabase/functions/_shared/github.ts')>()
  return {
    ...actual,
    fetchLatestCheckRun: vi.fn(async () => ({ status: rollup.status, conclusion: rollup.conclusion })),
    resolveProjectGithubToken: vi.fn(async () => 'ghs_test'),
  }
})

let db: FakeDb
let app: Hono

beforeAll(async () => {
  ;(globalThis as { Deno?: { env: { get: () => undefined } } }).Deno = { env: { get: () => undefined } }
  const { registerPublicRoutes } = await import('../../supabase/functions/api/routes/public.ts')
  app = new Hono()
  registerPublicRoutes(app as never)
})

beforeEach(() => {
  rollup.status = 'completed'
  rollup.conclusion = 'success'
  db = makeFakeDb({
    fix_attempts: [{
      id: ATTEMPT,
      project_id: PROJECT,
      commit_sha: SHA,
      check_run_status: 'completed',
      check_run_conclusion: 'failure',
      ci_infra: { infra: true, kind: 'runner_lost' },
    }],
    project_settings: [{ project_id: PROJECT, github_webhook_secret: SECRET }],
  })
})

function sign(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`
}

async function deliver(conclusion: string) {
  const body = JSON.stringify({
    repository: { full_name: 'kensaurus/glot.it' },
    installation: { id: 99 },
    check_run: { head_sha: SHA, status: 'completed', conclusion },
  })
  const res = await app.request('/v1/webhooks/github', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-GitHub-Event': 'check_run',
      'X-Hub-Signature-256': sign(body),
      'X-GitHub-Delivery': `delivery-${conclusion}`,
    },
    body,
  })
  return { status: res.status, json: await res.json() as { ok: boolean; data?: { updated?: number } } }
}

describe('POST /v1/webhooks/github check_run rollup', () => {
  it('stores a green rollup and clears a stale ci_infra when the event failed', async () => {
    const res = await deliver('failure')
    expect(res.status).toBe(200)
    expect(res.json.data?.updated).toBe(1)
    const row = db.tables.fix_attempts[0]
    expect(row?.check_run_conclusion).toBe('success')
    expect(row?.check_run_status).toBe('completed')
    expect(row?.ci_infra).toBeNull()
  })

  it('a still-red rollup keeps the infra flag', async () => {
    rollup.conclusion = 'failure'
    const res = await deliver('failure')
    expect(res.status).toBe(200)
    const row = db.tables.fix_attempts[0]
    expect(row?.check_run_conclusion).toBe('failure')
    expect(row?.ci_infra).toEqual({ infra: true, kind: 'runner_lost' })
  })
})
