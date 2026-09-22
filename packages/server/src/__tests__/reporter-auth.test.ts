/**
 * FILE: packages/server/src/__tests__/reporter-auth.test.ts
 * PURPOSE: The reporter-thread routes must resolve every accepted credential
 *          to the one-way key the reporter tables store, and must not accept
 *          a stored key back as a credential.
 *
 * Why (2026-09-22): the tables stored sha256(token), which is exactly what the
 * signed flow presents (the HMAC beside it is keyed by the public API key).
 * Any value an org member copied out of the console could read a reporter's
 * threads and reply as them. Storage is now rk1_ || sha256(digest).
 */
import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { resolveReporterAuth } from '../../supabase/functions/api/routes/reporter-auth.ts'

const PROJECT = '00000000-0000-4000-8000-0000000000aa'
const API_KEY = 'mushi_publickey_in_every_browser'
const NOW = Date.parse('2026-09-22T09:00:00.000Z')
const TOKEN = 'mushi_4f5a2d7e-1c3b-4e8a-9f6d-2b7c8e1a0d33'

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const DIGEST = sha256(TOKEN)
// Independent of the code under test: what every reporter table stores.
const STORED = `rk1_${sha256(DIGEST)}`

function ctx(headers: Record<string, string>, query: Record<string, string> = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    req: {
      header: (name: string) => lower[name.toLowerCase()],
      query: (name: string) => query[name],
    },
  } as never
}

function signed(tokenHash: string, ts = NOW) {
  const hmac = createHmac('sha256', API_KEY).update(`${PROJECT}.${ts}.${tokenHash.toLowerCase()}`).digest('hex')
  return {
    'X-Mushi-Api-Key': API_KEY,
    'X-Reporter-Token-Hash': tokenHash,
    'X-Reporter-Ts': String(ts),
    'X-Reporter-Hmac': hmac,
  }
}

const resolve = (c: ReturnType<typeof ctx>) => resolveReporterAuth(c, PROJECT, () => NOW)

describe('reporter-thread auth resolves to the stored key', () => {
  it('signed digest (what the SDKs send)', async () => {
    await expect(resolve(ctx(signed(DIGEST)))).resolves.toEqual({ ok: true, tokenHash: STORED })
  })

  it('an upper-case digest is the same reporter', async () => {
    await expect(resolve(ctx(signed(DIGEST.toUpperCase())))).resolves.toEqual({ ok: true, tokenHash: STORED })
  })

  it('raw token in the header and in the query (older SDKs)', async () => {
    await expect(resolve(ctx({ 'X-Reporter-Token': TOKEN }))).resolves.toEqual({ ok: true, tokenHash: STORED })
    await expect(resolve(ctx({}, { reporterToken: TOKEN }))).resolves.toEqual({ ok: true, tokenHash: STORED })
  })
})

describe('a stored value is not a credential', () => {
  it('the stored key replayed as a raw token finds nobody', async () => {
    const res = await resolve(ctx({ 'X-Reporter-Token': STORED }))
    expect(res.ok).toBe(true)
    expect(res.ok && res.tokenHash).not.toBe(STORED)
  })

  it('the stored key cannot be signed as a digest', async () => {
    await expect(resolve(ctx(signed(STORED)))).resolves.toMatchObject({ ok: false, status: 400, code: 'BAD_TOKEN_HASH' })
  })

  it('the hex part of the stored key, signed as a digest, finds nobody', async () => {
    const hexPart = STORED.slice(4)
    const res = await resolve(ctx(signed(hexPart)))
    expect(res.ok).toBe(true)
    expect(res.ok && res.tokenHash).not.toBe(STORED)
  })
})

describe('signed-flow checks', () => {
  it('rejects a signature made with a different key', async () => {
    const headers = { ...signed(DIGEST), 'X-Reporter-Hmac': createHmac('sha256', 'other').update('x').digest('hex') }
    await expect(resolve(ctx(headers))).resolves.toMatchObject({ ok: false, status: 401, code: 'INVALID_HMAC' })
  })

  it('rejects a request outside the 5-minute window', async () => {
    await expect(resolve(ctx(signed(DIGEST, NOW - 6 * 60 * 1000)))).resolves.toMatchObject({
      ok: false,
      status: 401,
      code: 'STALE_REQUEST',
    })
  })

  it('asks for a credential when none is sent', async () => {
    await expect(resolve(ctx({}))).resolves.toMatchObject({ ok: false, status: 400, code: 'MISSING_TOKEN' })
  })
})
