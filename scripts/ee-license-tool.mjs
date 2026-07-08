#!/usr/bin/env node
/**
 * FILE: scripts/ee-license-tool.mjs
 * PURPOSE: Maintainer-only tool for the EE license gate
 *          (packages/server/supabase/functions/_shared/ee-license.ts).
 *
 * Commands:
 *   node scripts/ee-license-tool.mjs keygen
 *       Generates an Ed25519 keypair. Prints the PRIVATE key to stdout ONCE
 *       (store it in a password manager — it is never written to disk) and
 *       rewrites EE_LICENSE_PUBLIC_KEY_B64URL in ee-license.ts in place.
 *
 *   node scripts/ee-license-tool.mjs sign <privateKeyB64url> <org> <exp YYYY-MM-DD>
 *       Mints a license key for a customer. Output goes into their
 *       MUSHI_EE_LICENSE_KEY env var.
 *
 *   node scripts/ee-license-tool.mjs verify <licenseKey>
 *       Verifies a license against the public key currently in ee-license.ts.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { webcrypto } from 'node:crypto'

const { subtle } = webcrypto
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EE_LICENSE_TS = resolve(
  ROOT,
  'packages/server/supabase/functions/_shared/ee-license.ts',
)
const PUBKEY_RE = /export const EE_LICENSE_PUBLIC_KEY_B64URL = '([A-Za-z0-9_-]+)'/

const toB64url = (bytes) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

const [cmd, ...args] = process.argv.slice(2)

if (cmd === 'keygen') {
  const pair = await subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const rawPub = toB64url(new Uint8Array(await subtle.exportKey('raw', pair.publicKey)))
  const pkcs8Priv = toB64url(new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey)))

  const src = readFileSync(EE_LICENSE_TS, 'utf8')
  if (!PUBKEY_RE.test(src)) {
    console.error('Could not find EE_LICENSE_PUBLIC_KEY_B64URL in ee-license.ts')
    process.exit(1)
  }
  writeFileSync(
    EE_LICENSE_TS,
    src.replace(PUBKEY_RE, `export const EE_LICENSE_PUBLIC_KEY_B64URL = '${rawPub}'`),
    'utf8',
  )
  console.log(`Public key written into ${EE_LICENSE_TS}`)
  console.log('Commit that change. Then store this PRIVATE key in your password manager —')
  console.log('it is shown once and never written to disk:\n')
  console.log(`  MUSHI_EE_PRIVATE_KEY=${pkcs8Priv}\n`)
  process.exit(0)
}

if (cmd === 'sign') {
  const [priv, org, exp] = args
  if (!priv || !org || !/^\d{4}-\d{2}-\d{2}$/.test(exp ?? '')) {
    console.error('usage: ee-license-tool.mjs sign <privateKeyB64url> <org> <exp YYYY-MM-DD>')
    process.exit(1)
  }
  const key = await subtle.importKey('pkcs8', fromB64url(priv), { name: 'Ed25519' }, false, ['sign'])
  const payload = Buffer.from(JSON.stringify({ org, exp }))
  const sig = new Uint8Array(await subtle.sign('Ed25519', key, payload))
  console.log(`mushi-ee.v1.${toB64url(payload)}.${toB64url(sig)}`)
  process.exit(0)
}

if (cmd === 'verify') {
  const [license] = args
  const src = readFileSync(EE_LICENSE_TS, 'utf8')
  const pub = src.match(PUBKEY_RE)?.[1]
  if (!license || !pub) {
    console.error('usage: ee-license-tool.mjs verify <licenseKey>')
    process.exit(1)
  }
  const parts = license.replace(/^mushi-ee\.v1\./, '').split('.')
  if (parts.length !== 2) {
    console.error('malformed license')
    process.exit(1)
  }
  const key = await subtle.importKey('raw', fromB64url(pub), { name: 'Ed25519' }, false, ['verify'])
  const ok = await subtle.verify('Ed25519', key, fromB64url(parts[1]), fromB64url(parts[0]))
  const payload = JSON.parse(fromB64url(parts[0]).toString('utf8'))
  console.log(ok ? `VALID — org=${payload.org} exp=${payload.exp}` : 'INVALID SIGNATURE')
  process.exit(ok ? 0 : 1)
}

console.error('usage: ee-license-tool.mjs keygen | sign … | verify …')
process.exit(1)
