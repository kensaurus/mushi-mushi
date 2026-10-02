import { generateKeyPairSync, verify } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pullAppStore, pullPlay, writeListing } from './pull.js'

const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
const ecPem = ec.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const rsaPem = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

describe('store pull signing', () => {
  it('signs an App Store Connect JWT the public key verifies', async () => {
    let auth = ''
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      auth = String((init?.headers as Record<string, string>).Authorization)
      return ok({ data: [] })
    }
    await pullAppStore(fetchImpl, '123', { keyId: 'KEY1', issuerId: 'issuer-1', privateKey: ecPem }, 1_000)
    const [h, b, s] = auth.replace('Bearer ', '').split('.')
    expect(decode(h)).toMatchObject({ alg: 'ES256', kid: 'KEY1' })
    expect(decode(b)).toMatchObject({ iss: 'issuer-1', aud: 'appstoreconnect-v1', exp: 2_200 })
    expect(verify('sha256', Buffer.from(`${h}.${b}`), { key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true)
  })

  it('signs a Google assertion for the androidpublisher scope', async () => {
    let assertion = ''
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        assertion = new URLSearchParams(String(init?.body)).get('assertion') ?? ''
        return ok({ access_token: 'tok' })
      }
      if (url.endsWith('/edits')) return ok({ id: 'e1' })
      return ok({})
    }
    await pullPlay(fetchImpl, 'com.x.app', { client_email: 'ci@p.iam.gserviceaccount.com', private_key: rsaPem }, 1_000)
    const [h, b, s] = assertion.split('.')
    expect(decode(b)).toMatchObject({ iss: 'ci@p.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/androidpublisher' })
    expect(verify('RSA-SHA256', Buffer.from(`${h}.${b}`), rsa.publicKey, Buffer.from(s, 'base64url'))).toBe(true)
  })
})

describe('pullAppStore', () => {
  it('reads app info and the live version into fastlane file names', async () => {
    const calls: string[] = []
    const fetchImpl = async (url: string) => {
      calls.push(url)
      if (url.endsWith('/apps/123/appInfos')) return ok({ data: [{ id: 'info-1', attributes: { appStoreState: 'READY_FOR_SALE' } }] })
      if (url.includes('/appInfos/info-1/appInfoLocalizations')) return ok({ data: [{ attributes: { locale: 'en-US', name: 'Hand', subtitle: 'Take photos', privacyPolicyUrl: 'https://x.test/p' } }] })
      if (url.includes('/apps/123/appStoreVersions')) return ok({ data: [{ id: 'v1' }] })
      if (url.includes('/appStoreVersions/v1/appStoreVersionLocalizations')) return ok({ data: [{ attributes: { locale: 'en-US', description: 'Long text', keywords: 'photo,help', promotionalText: null, whatsNew: 'Fixes' } }] })
      return ok({}, 404)
    }
    const files = await pullAppStore(fetchImpl, '123', { keyId: 'K', issuerId: 'I', privateKey: ecPem }, 1_000)
    expect(files).toEqual({
      'en-US/name.txt': 'Hand',
      'en-US/subtitle.txt': 'Take photos',
      'en-US/privacy_url.txt': 'https://x.test/p',
      'en-US/description.txt': 'Long text',
      'en-US/keywords.txt': 'photo,help',
      'en-US/release_notes.txt': 'Fixes',
    })
    expect(calls.every((u) => u.startsWith('https://api.appstoreconnect.apple.com/'))).toBe(true)
  })

  it('surfaces the store error detail, for example an unaccepted agreement', async () => {
    const fetchImpl = async () => ok({ errors: [{ detail: 'A required agreement is missing or has expired.' }] }, 403)
    await expect(pullAppStore(fetchImpl, '123', { keyId: 'K', issuerId: 'I', privateKey: ecPem }, 1_000)).rejects.toThrow(/403: A required agreement/)
  })
})

describe('pullPlay', () => {
  it('reads listings through a temporary edit and always deletes the edit', async () => {
    const methods: string[] = []
    const fetchImpl = async (url: string, init?: RequestInit) => {
      methods.push(`${init?.method ?? 'GET'} ${url.replace(/^https:\/\/[^/]+/, '')}`)
      if (url === 'https://oauth2.googleapis.com/token') return ok({ access_token: 'tok' })
      if (url.endsWith('/edits') && init?.method === 'POST') return ok({ id: 'e1' })
      if (url.endsWith('/edits/e1/listings')) return ok({ listings: [{ language: 'en-US', title: 'Hand', shortDescription: 'Short', fullDescription: 'Full', video: '' }] })
      return ok({})
    }
    const files = await pullPlay(fetchImpl, 'com.x.app', { client_email: 'ci@p', private_key: rsaPem }, 1_000)
    expect(files).toEqual({ 'android/en-US/title.txt': 'Hand', 'android/en-US/short_description.txt': 'Short', 'android/en-US/full_description.txt': 'Full' })
    expect(methods.at(-1)).toBe('DELETE /androidpublisher/v3/applications/com.x.app/edits/e1')
  })

  it('deletes the edit even when reading listings fails', async () => {
    const methods: string[] = []
    const fetchImpl = async (url: string, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET')
      if (url === 'https://oauth2.googleapis.com/token') return ok({ access_token: 'tok' })
      if (url.endsWith('/edits')) return ok({ id: 'e1' })
      if (url.endsWith('/listings')) return ok({ error: { message: 'The caller does not have permission' } }, 403)
      return ok({})
    }
    await expect(pullPlay(fetchImpl, 'com.x.app', { client_email: 'ci@p', private_key: rsaPem }, 1_000)).rejects.toThrow(/permission/)
    expect(methods.at(-1)).toBe('DELETE')
  })
})

describe('writeListing', () => {
  let dir = ''
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

  it('writes under the listing dir, ends files with a newline and refuses path escapes', () => {
    dir = mkdtempSync(join(tmpdir(), 'mushi-store-'))
    const written = writeListing(dir, 'fastlane/metadata', { 'en-US/name.txt': 'Hand', '../evil.txt': 'x' })
    expect(written).toEqual(['fastlane/metadata/en-US/name.txt'])
    expect(readFileSync(join(dir, 'fastlane/metadata/en-US/name.txt'), 'utf8')).toBe('Hand\n')
  })
})
