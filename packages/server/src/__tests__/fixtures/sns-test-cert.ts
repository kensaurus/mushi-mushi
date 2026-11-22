/**
 * Test helper: a throwaway RSA key and a real X.509 certificate for it, built
 * in-process (Node has no API that issues certificates, and no X.509 library
 * is a dependency). The DER is hand-encoded; sns-verify.test.ts proves Node's
 * own X509Certificate parses it and reports the same public key. Nothing here
 * is a secret: the key is generated per test run.
 */
import { Buffer } from 'node:buffer'
import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto'

function len(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n])
  const bytes: number[] = []
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff)
  return Buffer.from([0x80 | bytes.length, ...bytes])
}
const tlv = (tag: number, body: Buffer) => Buffer.concat([Buffer.from([tag]), len(body.length), body])
const seq = (...parts: Buffer[]) => tlv(0x30, Buffer.concat(parts))
const set = (...parts: Buffer[]) => tlv(0x31, Buffer.concat(parts))
const int = (n: number) => tlv(0x02, Buffer.from([n]))
const nul = () => Buffer.from([0x05, 0x00])
const SHA256_WITH_RSA = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b])
const CN = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03])
const name = (cn: string) => seq(set(seq(CN, tlv(0x0c, Buffer.from(cn, 'utf8')))))
const utc = (s: string) => tlv(0x17, Buffer.from(s, 'ascii'))

export interface TestSigner {
  privateKey: KeyObject
  certPem: string
  /** SPKI DER of the key, for comparing with the parser. */
  spkiDer: Buffer
}

export function makeTestSigner(commonName = 'sns.us-east-1.amazonaws.com'): TestSigner {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  const alg = seq(SHA256_WITH_RSA, nul())
  const tbs = seq(
    tlv(0xa0, int(2)), // [0] EXPLICIT version v3
    int(7), // serialNumber
    alg,
    name(commonName),
    seq(utc('260101000000Z'), utc('360101000000Z')),
    name(commonName),
    spkiDer,
  )
  const signature = createSign('RSA-SHA256').update(tbs).sign(privateKey)
  const der = seq(tbs, alg, tlv(0x03, Buffer.concat([Buffer.from([0x00]), signature])))
  const b64 = der.toString('base64').replace(/(.{64})/g, '$1\n')
  return { privateKey, spkiDer, certPem: `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n` }
}

/** Sign an SNS canonical string the way SNS does for SignatureVersion 1 (SHA1) or 2 (SHA256). */
export function snsSign(privateKey: KeyObject, stringToSign: string, version: '1' | '2'): string {
  return createSign(version === '1' ? 'RSA-SHA1' : 'RSA-SHA256').update(stringToSign, 'utf8').sign(privateKey, 'base64')
}
