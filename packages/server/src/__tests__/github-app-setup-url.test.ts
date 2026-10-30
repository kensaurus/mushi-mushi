/**
 * FILE: github-app-setup-url.test.ts
 * PURPOSE: The GitHub App setup URL (api/routes/public.ts) never binds an
 *          installation from its query string. A state minted by "Connect
 *          GitHub" goes on to GitHub's authorize page (the check that the
 *          person really reaches the installation); anything else is refused
 *          with a reason the console can explain.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'

const P = '1a000000-0000-4000-8000-000000000001'
const USER = '2a000000-0000-4000-8000-000000000001'

const ENV: Record<string, string> = {
  GITHUB_APP_SLUG: 'mushi-mushi-app',
  GITHUB_APP_CLIENT_ID: 'Iv1.client',
  GITHUB_APP_CLIENT_SECRET: 'shh',
  SUPABASE_URL: 'https://proj.supabase.co',
  MUSHI_GITHUB_CONNECT_SECRET: 'test-connect-secret',
  ADMIN_BASE_URL: 'https://kensaur.us/mushi-mushi/admin',
}

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

let db: FakeDb
let app: Hono
let connect: typeof import('../../supabase/functions/_shared/github-connect.ts')

beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: (k: string) => ENV[k] } })
  db = makeFakeDb({ project_repos: [], project_settings: [] })
  connect = await import('../../supabase/functions/_shared/github-connect.ts')
  const { registerPublicRoutes } = await import('../../supabase/functions/api/routes/public.ts')
  app = new Hono()
  registerPublicRoutes(app as never)
})

async function setup(query: Record<string, string>) {
  const res = await app.request(`/v1/webhooks/github/app-installation?${new URLSearchParams(query)}`)
  expect(res.status).toBe(302)
  return new URL(res.headers.get('location')!)
}

describe('GitHub App setup URL', () => {
  it('sends a signed connect state on to GitHub authorize, binding nothing', async () => {
    const state = await connect.signConnectState(ENV.MUSHI_GITHUB_CONNECT_SECRET, {
      p: P, u: USER, r: 'onboarding', exp: Math.floor(Date.now() / 1000) + 600,
    })
    const loc = await setup({ installation_id: '12345', setup_action: 'install', state })
    expect(loc.origin + loc.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(loc.searchParams.get('state')).toBe(state)
    expect(loc.searchParams.get('client_id')).toBe('Iv1.client')
    expect(db.table('project_repos')).toHaveLength(0)
    expect(db.table('project_settings')).toHaveLength(0)
  })

  it('says an old link expired', async () => {
    const state = await connect.signConnectState(ENV.MUSHI_GITHUB_CONNECT_SECRET, {
      p: P, u: USER, r: 'onboarding', exp: Math.floor(Date.now() / 1000) - 1,
    })
    const loc = await setup({ installation_id: '12345', setup_action: 'install', state })
    expect(loc.searchParams.get('github_error')).toBe('state_expired')
  })

  it('refuses a bare project id (the old install link) without binding it', async () => {
    const loc = await setup({ installation_id: '12345', setup_action: 'install', state: P })
    expect(loc.searchParams.get('github_error')).toBe('install_unverified')
    expect(db.table('project_repos')).toHaveLength(0)
    expect(db.table('project_settings')).toHaveLength(0)
  })

  it('keeps an organization approval request pending', async () => {
    const loc = await setup({ setup_action: 'request', state: P })
    expect(loc.searchParams.get('github_pending_approval')).toBe('1')
  })
})
