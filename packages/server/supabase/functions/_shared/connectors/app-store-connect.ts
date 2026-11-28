/**
 * FILE: packages/server/supabase/functions/_shared/connectors/app-store-connect.ts
 * PURPOSE: The App Store Connect connector (Plan 019 §2b, Plan 020 §5).
 *          A team API key (.p8) signs a 20-minute ES256 JWT
 *          (iss = issuer id, aud = appstoreconnect-v1, kid = key id).
 *          Snapshot: app versions and their state, the latest build, and
 *          in-app purchase / subscription review states.
 *
 * Act (Plan 025 P6, ADR 0074, amending ADR 0017 decision 2.2 for store
 * media only): `upload_screenshots` and `upload_app_preview` put release-kit
 * media on the editable App Store version, and run ONLY through
 * executeConnectorAction (_shared/connector-actions.ts) with the uploader
 * injected (store-media-act.ts, from api-ext's release-kit execute route only,
 * which keeps it out of the size-capped api bundle): a human-approved,
 * hash-matched, single-use, unexpired connector_actions row, with a
 * separate write key (App Manager role). Each asset is re-hashed after
 * download against the approved payload before a byte leaves for Apple.
 * Listing TEXT stays listing-as-code (S-1): the host's CI publishes it.
 *
 * Upload flow (developer.apple.com "Uploading Assets to App Store Connect",
 * read 2026-11-27): reserve (POST /v1/appScreenshots | /v1/appPreviews),
 * PUT each uploadOperations slice (unauthenticated URLs, no JWT sent),
 * commit (PATCH uploaded=true, sourceFileChecksum = MD5 of the file).
 * Apple marks the v1 asset objects deprecated as of API 4.5; the flow is
 * still the documented one. Tested against fixtures only.
 *
 * Blocked, not broken: when Apple refuses because a required agreement
 * (the Program License Agreement or Paid Apps) is not accepted, App Store
 * Connect answers 403 with an error code naming the agreement. Mushi shows
 * that as `blocked` with the step to take, never as an error or as ok.
 * The exact code Apple uses was not verifiable from public docs on
 * 2026-10-02; the check matches the code and the message text both.
 *
 * readCredential: JSON { keyId, issuerId, privateKey } (the .p8 text).
 * writeCredential (act): the same shape, a key with the App Manager role.
 */

import { sha256Hex, signJwt } from './jwt.ts'
import { failureOfStatus, fetchJson, statusReason, vendorError, type JsonResponse } from './http-util.ts'
import { canonicalJson } from './canonical.ts'
import { ConnectorError, notConnected, USE_RELEASE_KIT_MESSAGE, type ApprovedConnectorAction, type ConnectorActionResult, type ConnectorContext, type ProbeResult, type RecipeConnector } from './types.ts'
import type { StoreRead } from '../monetization/rules.ts'

export const API = 'https://api.appstoreconnect.apple.com'
const ASC_READ_SCOPE = 'a team API key with a read role (Developer or App Manager)'
const ASC_WRITE_SCOPE = 'a separate team API key with the App Manager role (uploads screenshots and app previews)'

export const AGREEMENT_BLOCKED_REASON =
  'Apple is refusing API access until the account holder accepts the current agreement in App Store Connect (Business → Agreements). Nothing is wrong with the key.'

export interface AscKey { keyId: string; issuerId: string; privateKey: string }

export function parseKey(raw: string | null): AscKey | null {
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

export async function token(ctx: ConnectorContext, key: AscKey): Promise<string> {
  const iat = Math.floor(ctx.now().getTime() / 1000)
  return signJwt('ES256', key.privateKey, { kid: key.keyId }, { iss: key.issuerId, iat, exp: iat + 1200, aud: 'appstoreconnect-v1' })
}

export async function asc(ctx: ConnectorContext, key: AscKey, path: string) {
  return fetchJson<any>(ctx, `${API}${path}`, { headers: { Authorization: `Bearer ${await token(ctx, key)}` } })
}

/**
 * One read-only GET with the connector's key (the store review intake reads
 * customer reviews with it). Throws ConnectorError `not_connected` when there
 * is no readable key.
 */
export async function appStoreConnectGet(ctx: ConnectorContext, path: string): Promise<JsonResponse<unknown>> {
  const key = parseKey(ctx.readCredential)
  if (!key) throw new ConnectorError('App Store Connect is not connected.', 'not_connected')
  return fetchJson<unknown>(ctx, `${API}${path}`, { headers: { Authorization: `Bearer ${await token(ctx, key)}` } })
}

/**
 * In-app purchases and subscriptions with their review state, for
 * monetization_store_product_unready. Optional: a refusal is `unknown` with
 * the reason, never "no products" and never a failed snapshot.
 */
async function iosProducts(ctx: ConnectorContext, key: AscKey, appleId: string): Promise<StoreRead> {
  const [iap, groups] = await Promise.all([
    asc(ctx, key, `/v1/apps/${appleId}/inAppPurchasesV2?limit=200&fields[inAppPurchases]=productId,state`),
    asc(ctx, key, `/v1/apps/${appleId}/subscriptionGroups?limit=50&include=subscriptions&fields[subscriptions]=productId,state&limit[subscriptions]=50`),
  ])
  for (const r of [iap, groups]) {
    if (isAgreementBlock(r.status, r.body)) return { state: 'unknown', reason: AGREEMENT_BLOCKED_REASON }
    if (r.status !== 200) return { state: 'unknown', reason: `In-app purchases could not be read: ${statusReason('App Store Connect', r.status)}` }
  }
  const rows = [
    ...((iap.body?.data ?? []) as Array<{ attributes?: Record<string, unknown> }>),
    ...((groups.body?.included ?? []) as Array<{ type?: string; attributes?: Record<string, unknown> }>).filter((x) => x.type === 'subscriptions'),
  ]
  return { state: 'read', items: rows.flatMap((x) => typeof x.attributes?.productId === 'string' ? [{ storeIdentifier: x.attributes.productId, state: String(x.attributes.state ?? 'UNKNOWN') }] : []) }
}

export const appStoreConnectConnector: RecipeConnector = {
  kind: 'app_store_connect',
  title: 'App Store Connect',
  capabilities: ['snapshot', 'drift', 'act'],
  requiredScopes: { snapshot: [ASC_READ_SCOPE], act: [ASC_WRITE_SCOPE] },
  credentialNote: 'Apple team API keys cannot be limited to one app: the key can see every app on the team. Mushi reads versions and builds with the read key. Uploading screenshots or app previews needs a separate key with the App Manager role, and every upload is approved by a person first. Listing text is published by your own CI, never by Mushi.',
  actions: ['upload_screenshots', 'upload_app_preview'],
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
    return { ok: false, status: 'error', granted: [], missing: res.status === 403 ? [ASC_READ_SCOPE] : [], reason: statusReason('App Store Connect', res.status), failure: failureOfStatus(res.status) }
  },
  async snapshot(ctx, bindings) {
    const key = parseKey(ctx.readCredential)
    if (!key) throw new ConnectorError('App Store Connect is not connected.', 'not_connected')
    const apps = bindings.filter((b) => /^\d{6,12}$/.test(b.externalId)).slice(0, 10)
    const out: Array<{ projectId: string; appleId: string; versions: Array<{ version: string; state: string; createdDate: string | null }>; latestBuild: { version: string; processingState: string; uploadedDate: string | null } | null; products: StoreRead }> = []
    for (const b of apps) {
      const v = await asc(ctx, key, `/v1/apps/${b.externalId}/appStoreVersions?limit=5&fields[appStoreVersions]=versionString,appVersionState,appStoreState,createdDate`)
      if (isAgreementBlock(v.status, v.body)) throw new ConnectorError(AGREEMENT_BLOCKED_REASON, 'blocked')
      if (v.status !== 200) throw vendorError('App Store Connect', v.status)
      const builds = await asc(ctx, key, `/v1/builds?filter[app]=${b.externalId}&sort=-uploadedDate&limit=1&fields[builds]=version,processingState,uploadedDate`)
      const lb = builds.status === 200 ? (builds.body?.data?.[0]?.attributes ?? null) : null
      out.push({
        projectId: b.projectId,
        appleId: b.externalId,
        versions: ((v.body?.data ?? []) as Array<{ attributes?: Record<string, string> }>).map((x) => ({ version: x.attributes?.versionString ?? '', state: x.attributes?.appVersionState ?? x.attributes?.appStoreState ?? 'UNKNOWN', createdDate: x.attributes?.createdDate ?? null })),
        latestBuild: lb ? { version: String(lb.version ?? ''), processingState: String(lb.processingState ?? ''), uploadedDate: lb.uploadedDate ?? null } : null,
        products: await iosProducts(ctx, key, b.externalId),
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
  async act(ctx, action: ApprovedConnectorAction): Promise<ConnectorActionResult> {
    // The approved hash first, before any parsing or network call.
    if (await sha256Hex(canonicalJson(action.payload)) !== action.payloadSha256) return { ok: false, detail: 'The payload does not match what was approved.' }
    if (action.action !== 'upload_screenshots' && action.action !== 'upload_app_preview') return { ok: false, detail: `Unknown App Store Connect action ${action.action}.` }
    // The uploader lives in store-media-act.ts and is injected by api-ext only (api's size budget).
    if (!ctx.storeMedia) return { ok: false, code: 'USE_RELEASE_KIT', status: 409, detail: USE_RELEASE_KIT_MESSAGE }
    return ctx.storeMedia.appStore(ctx, action)
  },
}
