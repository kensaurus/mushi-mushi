/**
 * jwtAuth verifies console tokens with `auth.getClaims` (local ES256 check
 * against the project's JWKS) instead of a GoTrue `getUser` round trip on
 * every request (2026-10-16). Pinned here:
 *   - a real ES256 user token verifies with the supplied JWKS and NO network;
 *   - expired, wrongly signed, anon-role and sub-less tokens are rejected;
 *   - verifyUserToken never throws, so jwtAuth keeps the Wave T 401 contract;
 *   - jwtAuth sets userId / userEmail from the claims and 401s otherwise.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const fakeLog = vi.hoisted(() => {
  const logger: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) logger[level] = vi.fn()
  logger.child = () => logger
  return logger
})
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ log: fakeLog, createLogger: () => fakeLog }))
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
const dbAuth = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({ auth: dbAuth.current }) }))

import { jwtAuth, verifyUserToken, type ClaimsVerifier } from '../../supabase/functions/_shared/auth.ts'

const KID = 'test-kid-1'
const enc = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url')

async function keyPair() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as Record<string, unknown>
  return { privateKey: pair.privateKey, jwks: { keys: [{ ...jwk, kid: KID, alg: 'ES256', use: 'sig', key_ops: ['verify'] }] } }
}

async function sign(privateKey: CryptoKey, claims: Record<string, unknown>, kid = KID): Promise<string> {
  const head = enc({ alg: 'ES256', typ: 'JWT', kid })
  const body = enc(claims)
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, Buffer.from(`${head}.${body}`))
  return `${head}.${body}.${Buffer.from(sig).toString('base64url')}`
}

const now = () => Math.floor(Date.now() / 1000)
const userClaims = (over: Record<string, unknown> = {}) => ({
  sub: '11111111-1111-4111-8111-111111111111',
  email: 'dev@example.test',
  role: 'authenticated',
  aud: 'authenticated',
  exp: now() + 3600,
  iat: now(),
  ...over,
})

function realAuth(): ClaimsVerifier {
  return createClient('https://project-ref.supabase.co', 'service-role-key', {
    auth: { autoRefreshToken: false, persistSession: false },
  }).auth as unknown as ClaimsVerifier
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('verifyUserToken with the real supabase-js getClaims', () => {
  it('verifies an ES256 user token against the supplied JWKS without any network call', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('network must not be used')
    })
    vi.stubGlobal('fetch', fetchSpy)
    const { privateKey, jwks } = await keyPair()
    const token = await sign(privateKey, userClaims())
    const user = await verifyUserToken(realAuth(), token, jwks)
    expect(user).toEqual({ id: '11111111-1111-4111-8111-111111111111', email: 'dev@example.test' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects an expired token, a token signed by another key, and an anon-role token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [] }), { status: 200 })))
    const { privateKey, jwks } = await keyPair()
    const other = await keyPair()
    expect(await verifyUserToken(realAuth(), await sign(privateKey, userClaims({ exp: now() - 10 })), jwks)).toBeNull()
    expect(await verifyUserToken(realAuth(), await sign(other.privateKey, userClaims()), jwks)).toBeNull()
    expect(
      await verifyUserToken(realAuth(), await sign(privateKey, userClaims({ role: 'anon', sub: undefined })), jwks),
    ).toBeNull()
  })

  it('rejects a malformed token without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    expect(await verifyUserToken(realAuth(), 'not-a-jwt', null)).toBeNull()
  })
})

describe('verifyUserToken claim rules', () => {
  const verifier = (result: unknown): ClaimsVerifier => ({ getClaims: vi.fn(async () => result) as never })

  it('needs a sub and the authenticated role', async () => {
    expect(await verifyUserToken(verifier({ data: { claims: userClaims({ sub: '' }) }, error: null }), 't', null)).toBeNull()
    expect(
      await verifyUserToken(verifier({ data: { claims: userClaims({ role: 'service_role' }) }, error: null }), 't', null),
    ).toBeNull()
    expect(await verifyUserToken(verifier({ data: null, error: { message: 'bad' } }), 't', null)).toBeNull()
    expect(await verifyUserToken(verifier({ data: null, error: null }), 't', null)).toBeNull()
  })

  it('treats a throwing verifier as an invalid token', async () => {
    const throwing: ClaimsVerifier = {
      getClaims: vi.fn(async () => {
        throw new Error('timeout')
      }) as never,
    }
    expect(await verifyUserToken(throwing, 't', null)).toBeNull()
  })

  it('passes the Edge Runtime SUPABASE_JWKS through to getClaims', async () => {
    const jwks = { keys: [{ kid: 'k', kty: 'EC' }] }
    vi.stubGlobal('Deno', { env: { get: (k: string) => (k === 'SUPABASE_JWKS' ? JSON.stringify(jwks) : undefined) } })
    const getClaims = vi.fn(async () => ({ data: { claims: userClaims() }, error: null }))
    await verifyUserToken({ getClaims } as never, 't')
    expect(getClaims).toHaveBeenCalledWith('t', { jwks })
  })
})

describe('jwtAuth', () => {
  function ctx(authorization?: string) {
    const vars = new Map<string, unknown>()
    let response: { body: unknown; status: number } | null = null
    const c = {
      req: { header: (k: string) => (k.toLowerCase() === 'authorization' ? authorization : undefined), raw: new Request('https://x.test') },
      set: (k: string, v: unknown) => vars.set(k, v),
      get: (k: string) => vars.get(k),
      json: (body: unknown, status = 200) => {
        response = { body, status }
        return response
      },
    }
    return { c, vars, response: () => response }
  }

  it('sets the user from verified claims', async () => {
    dbAuth.current = { getClaims: vi.fn(async () => ({ data: { claims: userClaims() }, error: null })) }
    const { c, vars } = ctx('Bearer token')
    const next = vi.fn(async () => {})
    await jwtAuth(c as never, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(vars.get('userId')).toBe('11111111-1111-4111-8111-111111111111')
    expect(vars.get('userEmail')).toBe('dev@example.test')
    expect(vars.get('authMethod')).toBe('jwt')
  })

  it('answers 401 for an invalid token and for a missing header', async () => {
    dbAuth.current = { getClaims: vi.fn(async () => ({ data: null, error: { message: 'invalid' } })) }
    const bad = ctx('Bearer token')
    const next = vi.fn(async () => {})
    await jwtAuth(bad.c as never, next)
    expect(bad.response()?.status).toBe(401)
    const missing = ctx(undefined)
    await jwtAuth(missing.c as never, next)
    expect(missing.response()?.status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })
})
