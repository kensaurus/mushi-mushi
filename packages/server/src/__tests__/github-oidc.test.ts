/**
 * FILE: github-oidc.test.ts
 * PURPOSE: Pin the GitHub Actions OIDC check that lets release.yml's
 *          `catalog-sync` job call `sdk-versions-cron` without a Supabase key.
 *          - the pure claims check rejects every claim that could let another
 *            repo, workflow, branch or event in, and expired tokens;
 *          - RS256 verification against a JWKS built from a key generated
 *            here (Web Crypto, same API in Node and Deno), and a tampered
 *            payload fails;
 *          - the caller gate: no bearer / junk bearer are 401 without any
 *            JWKS lookup, service role and a valid OIDC token pass;
 *          - the compare-only `expected` hint and the 202 stale computation;
 *          - release.yml holds no service-role key and requests the audience
 *            the function pins.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})

import {
  GITHUB_OIDC_ISSUER,
  MUSHI_REPOSITORY_ID,
  MUSHI_REPOSITORY_OWNER_ID,
  RELEASE_WORKFLOW_REF,
  SDK_CATALOG_OIDC_AUDIENCE,
  authorizeServiceRoleOrGithubOidc,
  checkGithubOidcClaims,
  verifyGithubOidcToken,
  type RsaJwk,
} from '../../supabase/functions/_shared/github-oidc.ts'
import { findStaleExpected, parseCatalogHint } from '../../supabase/functions/_shared/sdk-catalog-guard.ts'

const NOW = 1_790_000_000

function goodClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: GITHUB_OIDC_ISSUER,
    aud: SDK_CATALOG_OIDC_AUDIENCE,
    sub: 'repo:kensaurus/mushi-mushi:ref:refs/heads/master',
    repository: 'kensaurus/mushi-mushi',
    repository_id: MUSHI_REPOSITORY_ID,
    repository_owner: 'kensaurus',
    repository_owner_id: MUSHI_REPOSITORY_OWNER_ID,
    workflow_ref: RELEASE_WORKFLOW_REF,
    ref: 'refs/heads/master',
    event_name: 'push',
    run_id: '123',
    iat: NOW - 10,
    nbf: NOW - 10,
    exp: NOW + 300,
    ...overrides,
  }
}

describe('checkGithubOidcClaims', () => {
  it('accepts the release workflow on master for push and workflow_dispatch', () => {
    expect(checkGithubOidcClaims(goodClaims(), NOW).ok).toBe(true)
    expect(checkGithubOidcClaims(goodClaims({ event_name: 'workflow_dispatch' }), NOW).ok).toBe(true)
    expect(checkGithubOidcClaims(goodClaims({ aud: ['other', SDK_CATALOG_OIDC_AUDIENCE] }), NOW).ok).toBe(true)
  })

  it.each([
    ['issuer', { iss: 'https://token.actions.githubusercontent.com.evil.example' }, 'wrong issuer'],
    ['audience', { aud: 'npm:registry.npmjs.org' }, 'wrong audience'],
    ['repository id', { repository_id: '1' }, 'wrong repository_id'],
    ['repository id as a number', { repository_id: Number(MUSHI_REPOSITORY_ID) }, 'wrong repository_id'],
    ['owner id', { repository_owner_id: '2' }, 'wrong repository_owner_id'],
    [
      'workflow_ref on another branch',
      { workflow_ref: 'kensaurus/mushi-mushi/.github/workflows/release.yml@refs/heads/feature' },
      'wrong workflow_ref',
    ],
    ['workflow_ref with a master- prefix branch', { workflow_ref: `${RELEASE_WORKFLOW_REF}-evil` }, 'wrong workflow_ref'],
    [
      'another workflow file',
      { workflow_ref: 'kensaurus/mushi-mushi/.github/workflows/ci.yml@refs/heads/master' },
      'wrong workflow_ref',
    ],
    ['a pull_request event', { event_name: 'pull_request' }, 'event_name not allowed'],
    ['a pull_request_target event', { event_name: 'pull_request_target' }, 'event_name not allowed'],
    ['an expired token', { exp: NOW - 61 }, 'expired'],
    ['a token issued in the future', { iat: NOW + 120 }, 'issued in the future'],
    ['a not-yet-valid token', { nbf: NOW + 120 }, 'not yet valid'],
    ['a token without exp', { exp: undefined }, 'missing exp or iat'],
  ])('rejects %s', (_label, overrides, reason) => {
    expect(checkGithubOidcClaims(goodClaims(overrides), NOW)).toEqual({ ok: false, reason })
  })

  it('tolerates 60 s of clock skew on exp', () => {
    expect(checkGithubOidcClaims(goodClaims({ exp: NOW - 30 }), NOW).ok).toBe(true)
  })

  it('rejects non-object claims', () => {
    expect(checkGithubOidcClaims(null, NOW).ok).toBe(false)
    expect(checkGithubOidcClaims('x', NOW).ok).toBe(false)
  })
})

// ── RS256 with a locally generated key ───────────────────────────────

const KID = 'test-kid'
let privateKey: CryptoKey
let publicJwk: RsaJwk

const b64u = (bytes: Uint8Array | string) =>
  Buffer.from(typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes).toString('base64url')

async function sign(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: KID }) {
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(input))
  return `${input}.${b64u(new Uint8Array(sig))}`
}

const resolveKey = async (kid: string) => (kid === KID ? publicJwk : null)

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  privateKey = pair.privateKey
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  publicJwk = { kty: 'RSA', kid: KID, n: jwk.n, e: jwk.e, alg: 'RS256', use: 'sig' }
})

describe('verifyGithubOidcToken', () => {
  it('accepts a correctly signed token with good claims', async () => {
    const token = await sign(goodClaims())
    const result = await verifyGithubOidcToken(token, { nowSec: NOW, resolveKey })
    expect(result.ok).toBe(true)
  })

  it('rejects a tampered payload', async () => {
    const token = await sign(goodClaims())
    const [h, , s] = token.split('.')
    const forged = `${h}.${b64u(JSON.stringify(goodClaims({ run_id: '999' })))}.${s}`
    expect(await verifyGithubOidcToken(forged, { nowSec: NOW, resolveKey })).toEqual({
      ok: false,
      reason: 'bad signature',
    })
  })

  it('rejects a token signed by a different key under the same kid', async () => {
    const other = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )
    const input = `${b64u(JSON.stringify({ alg: 'RS256', kid: KID }))}.${b64u(JSON.stringify(goodClaims()))}`
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', other.privateKey, new TextEncoder().encode(input))
    const token = `${input}.${b64u(new Uint8Array(sig))}`
    expect((await verifyGithubOidcToken(token, { nowSec: NOW, resolveKey })).ok).toBe(false)
  })

  it('rejects an unknown kid, a non-RS256 alg and a missing kid', async () => {
    expect(await verifyGithubOidcToken(await sign(goodClaims(), { alg: 'RS256', kid: 'nope' }), { nowSec: NOW, resolveKey }))
      .toEqual({ ok: false, reason: 'unknown kid' })
    expect(await verifyGithubOidcToken(await sign(goodClaims(), { alg: 'HS256', kid: KID }), { nowSec: NOW, resolveKey }))
      .toEqual({ ok: false, reason: 'alg is not RS256' })
    expect(await verifyGithubOidcToken(await sign(goodClaims(), { alg: 'RS256' }), { nowSec: NOW, resolveKey }))
      .toEqual({ ok: false, reason: 'missing kid' })
  })

  it('checks claims before looking up a key', async () => {
    const lookup = vi.fn(resolveKey)
    const token = await sign(goodClaims({ event_name: 'pull_request' }))
    expect((await verifyGithubOidcToken(token, { nowSec: NOW, resolveKey: lookup })).ok).toBe(false)
    expect(lookup).not.toHaveBeenCalled()
  })
})

// ── Caller gate used by sdk-versions-cron ────────────────────────────

describe('authorizeServiceRoleOrGithubOidc', () => {
  const SERVICE = 'service-role-secret'
  const serviceRoleCheck = (req: Request) =>
    req.headers.get('Authorization') === `Bearer ${SERVICE}` ? null : new Response(null, { status: 401 })
  const post = (auth?: string) =>
    new Request('https://x.supabase.co/functions/v1/sdk-versions-cron', {
      method: 'POST',
      headers: auth ? { Authorization: auth } : {},
    })

  it('returns 401 with no bearer, and never looks up a key', async () => {
    const lookup = vi.fn(resolveKey)
    const result = await authorizeServiceRoleOrGithubOidc(post(), { serviceRoleCheck, resolveKey: lookup, nowSec: NOW })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(401)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('returns 401 for a junk bearer without a key lookup', async () => {
    const lookup = vi.fn(resolveKey)
    const result = await authorizeServiceRoleOrGithubOidc(post('Bearer not-a-jwt'), {
      serviceRoleCheck,
      resolveKey: lookup,
      nowSec: NOW,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(401)
    expect(lookup).not.toHaveBeenCalled()
  })

  it('accepts the service-role bearer', async () => {
    expect(await authorizeServiceRoleOrGithubOidc(post(`Bearer ${SERVICE}`), { serviceRoleCheck })).toEqual({
      ok: true,
      via: 'service_role',
    })
  })

  it('accepts a valid release-workflow OIDC token', async () => {
    const token = await sign(goodClaims())
    const result = await authorizeServiceRoleOrGithubOidc(post(`Bearer ${token}`), {
      serviceRoleCheck,
      resolveKey,
      nowSec: NOW,
    })
    expect(result).toMatchObject({ ok: true, via: 'github_oidc' })
  })

  it('returns 401 for a correctly signed token from a pull_request run', async () => {
    const token = await sign(goodClaims({ event_name: 'pull_request' }))
    const result = await authorizeServiceRoleOrGithubOidc(post(`Bearer ${token}`), {
      serviceRoleCheck,
      resolveKey,
      nowSec: NOW,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(401)
  })
})

// ── The compare-only hint ────────────────────────────────────────────

describe('parseCatalogHint / findStaleExpected', () => {
  const TRACKED = ['@mushi-mushi/core', '@mushi-mushi/web']

  it('keeps tracked packages, sets aside untracked ones, drops malformed entries', () => {
    const hint = parseCatalogHint(
      {
        expected: [
          { name: '@mushi-mushi/core', version: '1.2.3' },
          { name: '@mushi-mushi/mcp-ci', version: '0.1.0' },
          { name: '@mushi-mushi/web', version: 'latest' },
          { name: 42, version: '1.0.0' },
          null,
        ],
      },
      TRACKED,
    )
    expect(hint).toEqual({
      expected: [{ name: '@mushi-mushi/core', version: '1.2.3' }],
      ignored: ['@mushi-mushi/mcp-ci@0.1.0'],
    })
  })

  it('treats a missing or odd body as an empty hint', () => {
    expect(parseCatalogHint(undefined, TRACKED)).toEqual({ expected: [], ignored: [] })
    expect(parseCatalogHint({}, TRACKED)).toEqual({ expected: [], ignored: [] })
    expect(parseCatalogHint({ expected: 'x' }, TRACKED)).toEqual({ expected: [], ignored: [] })
  })

  it('caps the number of entries read', () => {
    const many = Array.from({ length: 500 }, () => ({ name: '@mushi-mushi/core', version: '1.0.0' }))
    expect(parseCatalogHint({ expected: many }, TRACKED).expected.length).toBe(50)
  })

  it('reports a version as stale only while npm latest is behind it or missing', () => {
    const expected = [
      { name: '@mushi-mushi/core', version: '1.2.3' },
      { name: '@mushi-mushi/web', version: '2.0.0' },
    ]
    expect(findStaleExpected(expected, { '@mushi-mushi/core': '1.2.2', '@mushi-mushi/web': '2.0.0' })).toEqual([
      '@mushi-mushi/core@1.2.3',
    ])
    expect(findStaleExpected(expected, { '@mushi-mushi/core': '1.2.4' })).toEqual(['@mushi-mushi/web@2.0.0'])
    expect(findStaleExpected(expected, { '@mushi-mushi/core': '1.2.3', '@mushi-mushi/web': '2.0.0' })).toEqual([])
  })
})

// ── release.yml contract ─────────────────────────────────────────────

describe('release.yml catalog sync', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
  const release = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8')

  it('holds no Supabase service-role key', () => {
    expect(release).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('requests the audience the function pins', () => {
    const m = release.match(/OIDC_AUDIENCE: (\S+)/)
    expect(m?.[1]).toBe(SDK_CATALOG_OIDC_AUDIENCE)
  })

  it('is the workflow file the function pins', () => {
    expect(RELEASE_WORKFLOW_REF).toBe('kensaurus/mushi-mushi/.github/workflows/release.yml@refs/heads/master')
  })
})
