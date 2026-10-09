/**
 * FILE: packages/server/src/__tests__/rewards-privacy-proof.test.ts
 * PURPOSE: GET /v1/sdk/me/export and DELETE /v1/sdk/me need proof that the
 *          request is for this user (api/routes/rewards.ts
 *          authorizeEndUserPrivacyAccess).
 *
 * Audit #31: the public SDK key is in every visitor's browser, and until
 * 2026-09-22 a project without a host auth provider accepted it alone — anyone
 * could export or erase any end user who had used the project, given only
 * their external id.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

let hostProviders = 0
let footprint = 1
let verified: { externalUserId: string; endUserId: string } | null = null

function fakeDb() {
  const chain: Record<string, unknown> = {}
  let table = ''
  for (const m of ['select', 'eq', 'limit', 'in', 'order']) chain[m] = () => chain
  chain.maybeSingle = async () => ({ data: table === 'end_users' ? { id: 'eu-1' } : null, error: null })
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({
      data: null,
      error: null,
      count: table === 'host_auth_providers' ? hostProviders : footprint,
    }).then(resolve)
  return {
    from: (t: string) => {
      table = t
      return chain
    },
    rpc: async () => ({ data: 1, error: null }),
  }
}

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => fakeDb() }))
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/end-user-identity.ts', () => ({
  MUSHI_USER_TOKEN_HEADER: 'X-Mushi-User-Token',
  verifyEndUserToken: async (_db: unknown, _p: string, token: string | undefined) => (token ? verified : null),
}))
vi.mock('../../supabase/functions/_shared/verify-host-jwt.ts', () => ({
  verifyHostJwt: async () => ({ sub: 'user-42' }),
}))

// Modules rewards.ts imports read Deno.env at load time.
vi.stubGlobal('Deno', { env: { get: () => undefined, toObject: () => ({}) } })

const { authorizeEndUserPrivacyAccess } = await import('../../supabase/functions/api/routes/rewards.ts')

function ctx(headers: Record<string, string> = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return { req: { header: (n: string) => lower[n.toLowerCase()] } }
}

async function access(headers: Record<string, string> = {}) {
  return authorizeEndUserPrivacyAccess(ctx(headers) as never, fakeDb() as never, 'proj-1', 'org-1', 'user-42')
}

beforeEach(() => {
  hostProviders = 0
  footprint = 1
  verified = null
})

describe('authorizeEndUserPrivacyAccess without a host auth provider', () => {
  it('refuses a request that carries only the public SDK key', async () => {
    expect(await access()).toMatchObject({ ok: false, status: 401, code: 'IDENTITY_PROOF_REQUIRED' })
  })

  it('refuses a signed token for a different user', async () => {
    verified = { externalUserId: 'someone-else', endUserId: 'eu-9' }
    expect(await access({ 'X-Mushi-User-Token': 'signed' })).toMatchObject({
      ok: false,
      status: 403,
      code: 'IDENTITY_SUBJECT_MISMATCH',
    })
  })

  it('allows a request signed for this user who has used the project', async () => {
    verified = { externalUserId: 'user-42', endUserId: 'eu-1' }
    expect(await access({ 'X-Mushi-User-Token': 'signed' })).toEqual({ ok: true, endUserId: 'eu-1' })
  })

  it('treats a verified user with no footprint in this project as unknown', async () => {
    verified = { externalUserId: 'user-42', endUserId: 'eu-1' }
    footprint = 0
    expect(await access({ 'X-Mushi-User-Token': 'signed' })).toEqual({ ok: true, endUserId: null })
  })
})

describe('authorizeEndUserPrivacyAccess with a host auth provider', () => {
  it('still requires the host JWT', async () => {
    hostProviders = 1
    expect(await access()).toMatchObject({ ok: false, status: 401, code: 'HOST_JWT_REQUIRED' })
    expect(await access({ 'X-Mushi-Host-Jwt': 'jwt' })).toEqual({ ok: true, endUserId: 'eu-1' })
  })
})
