/**
 * FILE: packages/server/supabase/functions/_shared/connectors/app-store-connect.ts
 * PURPOSE: The App Store Connect connector (Plan 019 §2b, Plan 020 §5),
 *          read-only. A team API key (.p8) signs a 20-minute ES256 JWT
 *          (iss = issuer id, aud = appstoreconnect-v1, kid = key id).
 *          Snapshot: app versions and their state, the latest build.
 *          No propose, no act (Plan 020 S-1: listings change through the
 *          host's own CI).
 *
 * Blocked, not broken: when Apple refuses because a required agreement
 * (the Program License Agreement or Paid Apps) is not accepted, App Store
 * Connect answers 403 with an error code naming the agreement. Mushi shows
 * that as `blocked` with the step to take, never as an error or as ok.
 * The exact code Apple uses was not verifiable from public docs on
 * 2026-10-02; the check matches the code and the message text both.
 *
 * readCredential: JSON { keyId, issuerId, privateKey } (the .p8 text).
 */

import { signJwt } from './jwt.ts'
import { fetchJson, statusReason } from './http-util.ts'
import { ConnectorError, notConnected, type ConnectorContext, type ProbeResult, type RecipeConnector } from './types.ts'

const API = 'https://api.appstoreconnect.apple.com'

export const AGREEMENT_BLOCKED_REASON =
  'Apple is refusing API access until the account holder accepts the current agreement in App Store Connect (Business → Agreements). Nothing is wrong with the key.'

interface AscKey { keyId: string; issuerId: string; privateKey: string }

function parseKey(raw: string | null): AscKey | null {
  if (!raw) return null
  try {
    const k = JSON.parse(raw) as Partial<AscKey>
    if (typeof k.keyId === 'string' && typeof k.issuerId === 'string' && typeof k.privateKey === 'string') return k as AscKey
  } catch {
    // fall through
  }
  return null
}

/** True when an App Store Connect error body says an agreement is missing or expired. */
export function isAgreementBlock(status: number, body: unknown): boolean {
  if (status !== 403) return false
  const errors = (body as { errors?: Array<{ code?: string; title?: string; detail?: string }> } | null)?.errors ?? []
  return errors.some((e) => /AGREEMENT/i.test(e.code ?? '') || /agreement/i.test(`${e.title ?? ''} ${e.detail ?? ''}`))
}

async function token(ctx: ConnectorContext, key: AscKey): Promise<string> {
  const iat = Math.floor(ctx.now().getTime() / 1000)
  return signJwt('ES256', key.privateKey, { kid: key.keyId }, { iss: key.issuerId, iat, exp: iat + 1200, aud: 'appstoreconnect-v1' })
}

async function asc(ctx: ConnectorContext, key: AscKey, path: string) {
  return fetchJson<any>(ctx, `${API}${path}`, { headers: { Authorization: `Bearer ${await token(ctx, key)}` } })
}

export const appStoreConnectConnector: RecipeConnector = {
  kind: 'app_store_connect',
  title: 'App Store Connect',
  capabilities: ['snapshot', 'drift'],
  requiredScopes: { snapshot: ['a team API key with a read role (Developer or App Manager)'] },
  credentialNote: 'Apple team API keys cannot be limited to one app: the key can see every app on the team. Mushi only reads versions and builds with it. Listings are published by your own CI, never by Mushi.',
  async probe(ctx): Promise<ProbeResult> {
    const key = parseKey(ctx.readCredential)
    if (!key) return notConnected('Add an App Store Connect API key (key id, issuer id and the .p8 file).')
    let res
    try {
      res = await asc(ctx, key, '/v1/apps?limit=1')
    } catch (err) {
      return { ok: false, status: 'error', granted: [], missing: [], reason: `Could not sign or send the request: ${(err as Error).message.slice(0, 160)}` }
    }
    if (isAgreementBlock(res.status, res.body)) return { ok: false, status: 'blocked', granted: [], missing: [], reason: AGREEMENT_BLOCKED_REASON }
    if (res.status === 200) return { ok: true, status: 'connected', granted: ['apps:read'], missing: [] }
    return { ok: false, status: 'error', granted: [], missing: [], reason: statusReason('App Store Connect', res.status) }
  },
  async snapshot(ctx, bindings) {
    const key = parseKey(ctx.readCredential)
    if (!key) throw new ConnectorError('App Store Connect is not connected.', 'not_connected')
    const apps = bindings.filter((b) => /^\d{6,12}$/.test(b.externalId)).slice(0, 10)
    const out: Array<{ projectId: string; appleId: string; versions: Array<{ version: string; state: string; createdDate: string | null }>; latestBuild: { version: string; processingState: string; uploadedDate: string | null } | null }> = []
    for (const b of apps) {
      const v = await asc(ctx, key, `/v1/apps/${b.externalId}/appStoreVersions?limit=5&fields[appStoreVersions]=versionString,appVersionState,appStoreState,createdDate`)
      if (isAgreementBlock(v.status, v.body)) throw new ConnectorError(AGREEMENT_BLOCKED_REASON, 'blocked')
      if (v.status !== 200) throw new ConnectorError(statusReason('App Store Connect', v.status))
      const builds = await asc(ctx, key, `/v1/builds?filter[app]=${b.externalId}&sort=-uploadedDate&limit=1&fields[builds]=version,processingState,uploadedDate`)
      const lb = builds.status === 200 ? (builds.body?.data?.[0]?.attributes ?? null) : null
      out.push({
        projectId: b.projectId,
        appleId: b.externalId,
        versions: ((v.body?.data ?? []) as Array<{ attributes?: Record<string, string> }>).map((x) => ({ version: x.attributes?.versionString ?? '', state: x.attributes?.appVersionState ?? x.attributes?.appStoreState ?? 'UNKNOWN', createdDate: x.attributes?.createdDate ?? null })),
        latestBuild: lb ? { version: String(lb.version ?? ''), processingState: String(lb.processingState ?? ''), uploadedDate: lb.uploadedDate ?? null } : null,
      })
    }
    // appVersionState (READY_FOR_DISTRIBUTION) replaced the deprecated appStoreState (READY_FOR_SALE).
    const live = out[0]?.versions.find((x) => x.state === 'READY_FOR_DISTRIBUTION' || x.state === 'READY_FOR_SALE')?.version ?? null
    return {
      observedAt: ctx.now().toISOString(),
      elements: { deploy: { summary: { iosLive: live, iosInReview: out[0]?.versions.some((x) => /IN_REVIEW|WAITING_FOR_REVIEW/.test(x.state)) ?? null } } },
      resources: out.map((a) => ({ kind: 'bundle_id', externalId: `ios:${a.appleId}`, role: 'app_store' })),
      facts: { apps: out },
    }
  },
  detectDrift(_prev, next) {
    const apps = (next.facts.apps ?? []) as Array<{ appleId: string; versions: Array<{ version: string; state: string; createdDate: string | null }> }>
    const now = Date.parse(next.observedAt)
    return apps.flatMap((a) => a.versions
      .filter((v) => /IN_REVIEW|WAITING_FOR_REVIEW/.test(v.state) && v.createdDate && now - Date.parse(v.createdDate) > 7 * 86400_000)
      .map((v) => ({ gate: 'deploy_drift', ruleId: 'store_review_stuck', severity: 'warn' as const, message: `iOS version ${v.version} has waited in App Store review for more than 7 days.`, suggestedFix: { kind: 'prompt' as const, text: 'Check the Resolution Center in App Store Connect for a message from App Review.' } })))
  },
}
