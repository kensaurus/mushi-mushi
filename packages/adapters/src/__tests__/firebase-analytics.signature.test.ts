/**
 * FILE: firebase-analytics.signature.test.ts
 * PURPOSE: Exercise the default RS256 JWKS path of the Firebase Analytics adapter.
 *
 * OVERVIEW:
 * - Serves a local JWKS so signature checks run without calling Google.
 * - Covers a valid Google issuer, a bad key, a tampered payload, audience
 *   strictness, and a valid signature from the wrong issuer.
 *
 * DEPENDENCIES: jose, node:http, vitest, ./shared-hmac-fixtures.ts
 * USAGE: `pnpm --filter @mushi-mushi/adapters test`
 *
 * NOTES:
 * The unsigned `verifySignature: false` cases stay in firebase-analytics.test.ts.
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createFirebaseAnalyticsAdapter } from '../firebase-analytics.js'
import { makeReq, makeSink } from './shared-hmac-fixtures.js'

const PROJECT_ID = 'my-analytics-project'
const KID = 'fixture-kid'
const GOOGLE_ISS = 'https://accounts.google.com'

let server: Server
let jwksUri: string
let privateKey: CryptoKey
let otherPrivateKey: CryptoKey

function encodePubSubData(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64')
}

async function sign(
  claims: { aud: string; iss: string },
  key: CryptoKey = privateKey,
): Promise<string> {
  return new SignJWT({ sub: 'test' })
    .setProtectedHeader({ alg: 'RS256', kid: KID, typ: 'JWT' })
    .setIssuer(claims.iss)
    .setAudience(claims.aud)
    .setExpirationTime('5m')
    .sign(key)
}

function makeHandler(opts: Partial<Parameters<typeof createFirebaseAnalyticsAdapter>[0]> = {}) {
  const { sink, calls } = makeSink()
  const handler = createFirebaseAnalyticsAdapter({
    sink,
    projectId: PROJECT_ID,
    jwksUri,
    ...opts,
  })
  return { handler, calls }
}

async function post(token: string, event: unknown = { eventType: 'purchase', userId: 'u1' }) {
  const { handler, calls } = makeHandler()
  const data = encodePubSubData(event)
  const res = await handler(makeReq({ message: { data } }, { authorization: `Bearer ${token}` }))
  return { res, calls }
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true })
  const other = await generateKeyPair('RS256', { extractable: true })
  privateKey = pair.privateKey
  otherPrivateKey = other.privateKey
  const jwk = await exportJWK(pair.publicKey)
  const published: JWK = { ...jwk, kid: KID, alg: 'RS256', use: 'sig' }
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ keys: [published] }))
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address() as AddressInfo
  jwksUri = `http://127.0.0.1:${port}/oauth2/v3/certs`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
})

describe('createFirebaseAnalyticsAdapter JWKS signature', () => {
  it('accepts an RS256 token from the fixture key and the https Google issuer', async () => {
    const token = await sign({ aud: PROJECT_ID, iss: GOOGLE_ISS })
    const { res, calls } = await post(token)
    expect(res.status).toBe(200)
    expect((res.body as { ok: boolean }).ok).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('accepts the bare accounts.google.com issuer', async () => {
    const token = await sign({ aud: PROJECT_ID, iss: 'accounts.google.com' })
    const { res, calls } = await post(token)
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })

  it('accepts a custom expectedAudience when the aud claim matches it', async () => {
    const audience = 'https://webhook.example.com/analytics'
    const token = await sign({ aud: audience, iss: GOOGLE_ISS })
    const { handler, calls } = makeHandler({ expectedAudience: audience })
    const data = encodePubSubData({ eventType: 'purchase' })
    const res = await handler(makeReq({ message: { data } }, { authorization: `Bearer ${token}` }))
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })

  it('rejects a token signed by a different key', async () => {
    const token = await sign({ aud: PROJECT_ID, iss: GOOGLE_ISS }, otherPrivateKey)
    const { res, calls } = await post(token)
    expect(res.status).toBe(401)
    expect((res.body as { error: string }).error).toBe('INVALID_TOKEN')
    expect(calls).toHaveLength(0)
  })

  it('rejects a tampered payload', async () => {
    const token = await sign({ aud: PROJECT_ID, iss: GOOGLE_ISS })
    const [header, , signature] = token.split('.')
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: 'attacker', aud: PROJECT_ID, iss: GOOGLE_ISS }),
    ).toString('base64url')
    const { res } = await post(`${header}.${forgedPayload}.${signature}`)
    expect(res.status).toBe(401)
    expect((res.body as { error: string }).error).toBe('INVALID_TOKEN')
  })

  it('rejects an aud that is not the project id, including a substring spoof', async () => {
    const wrong = await sign({ aud: 'other-project', iss: GOOGLE_ISS })
    const spoof = await sign({ aud: `${PROJECT_ID}-evil`, iss: GOOGLE_ISS })
    const wrongRes = await post(wrong)
    const spoofRes = await post(spoof)
    expect((wrongRes.res.body as { error: string }).error).toBe('INVALID_TOKEN')
    expect((spoofRes.res.body as { error: string }).error).toBe('INVALID_TOKEN')
    expect(wrongRes.calls).toHaveLength(0)
    expect(spoofRes.calls).toHaveLength(0)
  })

  it('rejects a valid signature from a non-Google issuer', async () => {
    const token = await sign({ aud: PROJECT_ID, iss: 'https://evil.example' })
    const { res, calls } = await post(token)
    expect(res.status).toBe(401)
    expect((res.body as { error: string }).error).toBe('INVALID_ISS')
    expect(calls).toHaveLength(0)
  })
})
