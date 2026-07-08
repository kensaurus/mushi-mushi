import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { verifyEeLicense } from '../../_shared/ee-license.ts'

function bytesToB64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Generate a throwaway Ed25519 keypair and sign a payload with it. */
async function makeSignedLicense(
  payload: Record<string, unknown>,
): Promise<{ licenseKey: string; publicKeyB64url: string }> {
  const pair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, payloadBytes))
  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return {
    licenseKey: `mushi-ee.v1.${bytesToB64url(payloadBytes)}.${bytesToB64url(sig)}`,
    publicKeyB64url: bytesToB64url(rawPub),
  }
}

Deno.test('unset key → eval mode (never hard-off)', async () => {
  assertEquals(await verifyEeLicense(undefined), { mode: 'eval', reason: 'unset' })
  assertEquals(await verifyEeLicense('  '), { mode: 'eval', reason: 'unset' })
})

Deno.test('garbage key → eval/malformed', async () => {
  assertEquals(await verifyEeLicense('not-a-license'), { mode: 'eval', reason: 'malformed' })
  assertEquals(await verifyEeLicense('mushi-ee.v1.onlyonepart'), { mode: 'eval', reason: 'malformed' })
  assertEquals(
    await verifyEeLicense('mushi-ee.v1.!!!.???'),
    { mode: 'eval', reason: 'malformed' },
  )
})

Deno.test('valid signature within term → licensed', async () => {
  const { licenseKey, publicKeyB64url } = await makeSignedLicense({ org: 'Acme', exp: '2030-01-01' })
  assertEquals(
    await verifyEeLicense(licenseKey, publicKeyB64url, new Date('2026-07-08T00:00:00Z')),
    { mode: 'licensed', org: 'Acme', expiresAt: '2030-01-01' },
  )
})

Deno.test('expired license → eval/expired (valid THROUGH the exp day)', async () => {
  const { licenseKey, publicKeyB64url } = await makeSignedLicense({ org: 'Acme', exp: '2026-01-31' })
  // Still licensed at 23:00 UTC on the exp day…
  assertEquals(
    (await verifyEeLicense(licenseKey, publicKeyB64url, new Date('2026-01-31T23:00:00Z'))).mode,
    'licensed',
  )
  // …eval the next day.
  assertEquals(
    await verifyEeLicense(licenseKey, publicKeyB64url, new Date('2026-02-01T00:00:01Z')),
    { mode: 'eval', reason: 'expired' },
  )
})

Deno.test('signature from a different key → eval/bad-signature', async () => {
  const { licenseKey } = await makeSignedLicense({ org: 'Acme', exp: '2030-01-01' })
  const { publicKeyB64url: otherPub } = await makeSignedLicense({ org: 'Other', exp: '2030-01-01' })
  assertEquals(
    await verifyEeLicense(licenseKey, otherPub, new Date('2026-07-08T00:00:00Z')),
    { mode: 'eval', reason: 'bad-signature' },
  )
})

Deno.test('tampered payload → eval/bad-signature', async () => {
  const { licenseKey, publicKeyB64url } = await makeSignedLicense({ org: 'Acme', exp: '2030-01-01' })
  const [prefix, , sig] = [licenseKey.slice(0, 12), '', licenseKey.split('.').at(-1)!]
  const forged = `${prefix}${bytesToB64url(new TextEncoder().encode(JSON.stringify({ org: 'Evil', exp: '2099-01-01' })))}.${sig}`
  assertEquals(
    (await verifyEeLicense(forged, publicKeyB64url, new Date('2026-07-08T00:00:00Z'))).mode,
    'eval',
  )
})

Deno.test('default embedded placeholder public key verifies nothing', async () => {
  const { licenseKey } = await makeSignedLicense({ org: 'Acme', exp: '2030-01-01' })
  // No publicKey argument → uses the embedded placeholder → must stay eval.
  const status = await verifyEeLicense(licenseKey)
  assertEquals(status.mode, 'eval')
})
