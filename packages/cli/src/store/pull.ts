/**
 * FILE: packages/cli/src/store/pull.ts
 * PURPOSE: `mushi store pull` (Plan 020 §5.2): copy the live App Store and
 *          Google Play listings into the repo in fastlane's metadata layout,
 *          once, so the listing lives as code from then on. It runs on the
 *          operator's machine with the operator's own keys; nothing is sent
 *          to Mushi and Mushi never holds a store write credential.
 *
 *   App Store Connect: a team API key (.p8) signs a 20-minute ES256 JWT.
 *   Google Play: a service account signs an RS256 assertion for an OAuth
 *   token; listings are read through a temporary edit that is deleted.
 */

import { createSign, sign as cryptoSign } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function ascJwt(keyId: string, issuerId: string, privateKeyPem: string, nowSec: number): string {
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }))
  const body = b64url(JSON.stringify({ iss: issuerId, iat: nowSec, exp: nowSec + 1200, aud: 'appstoreconnect-v1' }))
  const sig = cryptoSign('sha256', Buffer.from(`${head}.${body}`), { key: privateKeyPem, dsaEncoding: 'ieee-p1363' })
  return `${head}.${body}.${b64url(sig)}`
}

function googleAssertion(clientEmail: string, privateKeyPem: string, nowSec: number): string {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify({ iss: clientEmail, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: nowSec, exp: nowSec + 3600 }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${head}.${body}`)
  return `${head}.${body}.${b64url(signer.sign(privateKeyPem))}`
}

async function json(fetchImpl: Fetch, url: string, init: RequestInit): Promise<any> {
  const res = await fetchImpl(url, init)
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = (body as { errors?: Array<{ detail?: string }>; error?: { message?: string } } | null)?.errors?.[0]?.detail ?? (body as { error?: { message?: string } } | null)?.error?.message ?? ''
    throw new Error(`${new URL(url).host} answered ${res.status}${detail ? `: ${detail}` : ''}`)
  }
  return body
}

/** fastlane deliver file names (kept in step with the server's store-listing.ts). */
const IOS_FILES = { name: 'name.txt', subtitle: 'subtitle.txt', privacyPolicyUrl: 'privacy_url.txt', description: 'description.txt', keywords: 'keywords.txt', promotionalText: 'promotional_text.txt', whatsNew: 'release_notes.txt' } as const
const ANDROID_FILES = { title: 'title.txt', shortDescription: 'short_description.txt', fullDescription: 'full_description.txt', video: 'video.txt' } as const

export async function pullAppStore(fetchImpl: Fetch, appId: string, key: { keyId: string; issuerId: string; privateKey: string }, nowSec: number): Promise<Record<string, string>> {
  const auth = { headers: { Authorization: `Bearer ${ascJwt(key.keyId, key.issuerId, key.privateKey, nowSec)}` } }
  const base = 'https://api.appstoreconnect.apple.com/v1'
  const out: Record<string, string> = {}
  const infos = await json(fetchImpl, `${base}/apps/${appId}/appInfos`, auth)
  // `state` / `appVersionState` replaced the deprecated `appStoreState`; accept either.
  const isLive = (a: any) => a?.state === 'READY_FOR_DISTRIBUTION' || a?.appStoreState === 'READY_FOR_SALE'
  const info = (infos.data ?? []).find((i: any) => isLive(i.attributes)) ?? infos.data?.[0]
  if (info) {
    const locs = await json(fetchImpl, `${base}/appInfos/${info.id}/appInfoLocalizations`, auth)
    for (const l of locs.data ?? []) {
      const a = l.attributes ?? {}
      for (const k of ['name', 'subtitle', 'privacyPolicyUrl'] as const) if (typeof a[k] === 'string') out[`${a.locale}/${IOS_FILES[k]}`] = a[k]
    }
  }
  const versions = await json(fetchImpl, `${base}/apps/${appId}/appStoreVersions?filter[appVersionState]=READY_FOR_DISTRIBUTION&limit=1`, auth)
  const version = versions.data?.[0]
  if (version) {
    const locs = await json(fetchImpl, `${base}/appStoreVersions/${version.id}/appStoreVersionLocalizations`, auth)
    for (const l of locs.data ?? []) {
      const a = l.attributes ?? {}
      for (const k of ['description', 'keywords', 'promotionalText', 'whatsNew'] as const) if (typeof a[k] === 'string') out[`${a.locale}/${IOS_FILES[k]}`] = a[k]
    }
  }
  return out
}

export async function pullPlay(fetchImpl: Fetch, pkg: string, sa: { client_email: string; private_key: string }, nowSec: number): Promise<Record<string, string>> {
  const tokenBody = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(googleAssertion(sa.client_email, sa.private_key, nowSec))}`
  const token = await json(fetchImpl, 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenBody })
  const auth = { Authorization: `Bearer ${token.access_token}` }
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}`
  const edit = await json(fetchImpl, `${base}/edits`, { method: 'POST', headers: auth })
  const out: Record<string, string> = {}
  try {
    const listings = await json(fetchImpl, `${base}/edits/${edit.id}/listings`, { headers: auth })
    for (const l of listings.listings ?? []) {
      for (const k of Object.keys(ANDROID_FILES) as Array<keyof typeof ANDROID_FILES>) if (typeof l[k] === 'string' && l[k]) out[`android/${l.language}/${ANDROID_FILES[k]}`] = l[k]
    }
  } finally {
    await fetchImpl(`${base}/edits/${edit.id}`, { method: 'DELETE', headers: auth }).catch(() => undefined)
  }
  return out
}

/** Write pulled files under listingDir; returns the repo paths written. */
export function writeListing(root: string, listingDir: string, files: Record<string, string>): string[] {
  const written: string[] = []
  for (const [rel, text] of Object.entries(files)) {
    if (rel.includes('..')) continue
    const path = join(root, listingDir, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`)
    written.push(`${listingDir}/${rel}`)
  }
  return written.sort()
}
