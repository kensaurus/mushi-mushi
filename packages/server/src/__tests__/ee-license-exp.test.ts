/**
 * A signed key whose exp passes the YYYY-MM-DD shape but is not a real day
 * (2026-02-31) used to verify as licensed, because Date.parse rolls it over
 * to 2026-03-03. It is now malformed.
 */
import { webcrypto } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyEeLicense } from '../../supabase/functions/_shared/ee-license.ts'

const b64url = (b: Uint8Array) => Buffer.from(b).toString('base64url')

async function mint(exp: string) {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
  const pub = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey))
  const payload = new TextEncoder().encode(JSON.stringify({ org: 'acme', exp }))
  const sig = new Uint8Array(await webcrypto.subtle.sign('Ed25519', pair.privateKey, payload))
  return { key: `mushi-ee.v1.${b64url(payload)}.${b64url(sig)}`, pub: b64url(pub) }
}

const NOW = new Date('2026-01-15T00:00:00Z')

describe('verifyEeLicense exp date', () => {
  it('treats an impossible calendar day as malformed, not licensed', async () => {
    const { key, pub } = await mint('2026-02-31')
    expect(await verifyEeLicense(key, pub, NOW)).toEqual({ mode: 'eval', reason: 'malformed' })
  })

  it('licenses a real day through the end of that day', async () => {
    const { key, pub } = await mint('2026-02-28')
    expect(await verifyEeLicense(key, pub, NOW)).toEqual({ mode: 'licensed', org: 'acme', expiresAt: '2026-02-28' })
  })
})
