/**
 * FILE: github-installation-token-cache.test.ts
 * PURPOSE: An installation token lives an hour, so Mushi mints one per
 *          installation and reuses it. The Apps page composed 10 cards on one
 *          installation and minted 10 tokens per view (2026-10-31, 13.9 s
 *          against the console's 15 s limit).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const env: Record<string, string> = {}
;(globalThis as typeof globalThis & { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno ??= {
  env: { get: (key: string) => env[key] ?? process.env[key] },
}

const github = await import('../../supabase/functions/_shared/github.ts')

const realFetch = globalThis.fetch
let mints = 0
let failNext = false
let expiresInMs = 60 * 60_000

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64')
  env.GITHUB_APP_ID = '123'
  env.GITHUB_APP_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----`
})

beforeEach(() => {
  github.clearInstallationTokenCache()
  mints = 0
  failNext = false
  expiresInMs = 60 * 60_000
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    expect(String(url)).toMatch(/\/app\/installations\/\d+\/access_tokens$/)
    mints++
    if (failNext) {
      failNext = false
      return new Response('{}', { status: 502 })
    }
    return new Response(
      JSON.stringify({ token: `ghs_${mints}`, expires_at: new Date(Date.now() + expiresInMs).toISOString(), permissions: { contents: 'write' } }),
      { status: 201 },
    )
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  vi.useRealTimers()
})

describe('installation token cache', () => {
  it('concurrent callers share one mint, and later calls reuse it', async () => {
    const tokens = await Promise.all(Array.from({ length: 10 }, () => github.mintInstallationToken(42)))
    expect(new Set(tokens)).toEqual(new Set(['ghs_1']))
    expect(await github.mintInstallationToken(42)).toBe('ghs_1')
    expect((await github.mintInstallationAccess(42)).permissions).toEqual({ contents: 'write' })
    expect(mints).toBe(1)
  })

  it('keeps tokens per installation', async () => {
    expect(await github.mintInstallationToken(1)).toBe('ghs_1')
    expect(await github.mintInstallationToken(2)).toBe('ghs_2')
    expect(mints).toBe(2)
  })

  it('mints again within 5 minutes of expiry', async () => {
    expiresInMs = 4 * 60_000
    await github.mintInstallationToken(42)
    expect(await github.mintInstallationToken(42)).toBe('ghs_2')
    expect(mints).toBe(2)
  })

  it('does not cache a failed mint', async () => {
    failNext = true
    await expect(github.mintInstallationToken(42)).rejects.toThrow(/mint failed: 502/)
    expect(await github.mintInstallationToken(42)).toBe('ghs_2')
  })
})
