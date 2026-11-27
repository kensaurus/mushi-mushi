/**
 * FILE: packages/server/supabase/functions/_shared/connectors/store-media-act.ts
 * PURPOSE: The store media uploaders (Plan 025 P6, ADR 0074): App Store
 *          screenshots and app previews, Google Play listing images and the
 *          promo video URL. The App Store Connect and Play connectors declare
 *          these actions and delegate here through ctx.storeMedia, which only
 *          api-ext's release-kit execute route injects (api/routes/release-kits.ts),
 *          so this code never ships in the size-capped api bundle. The generic
 *          execute route refuses these actions before claiming them.
 *
 * Every asset is downloaded and re-hashed against the approved payload before
 * a byte is sent (store-media.ts downloadKitAsset). Tested against fixtures
 * only; no live store call.
 */

import { fetchJson, statusReason, type JsonResponse } from './http-util.ts'
import type { ApprovedConnectorAction, ConnectorActionResult, ConnectorContext, StoreMediaActs } from './types.ts'
import { AGREEMENT_BLOCKED_REASON, API, asc, isAgreementBlock, parseKey, token, type AscKey } from './app-store-connect.ts'
import { accessToken, api, parseSa, PKG, type ServiceAccount } from './play-console.ts'
import {
  APPLE_PREVIEW, APPLE_PREVIEW_SIZES, APPLE_SCREENSHOT_SIZES, APPLE_SCREENSHOTS_PER_SET,
  assetsOutsideKit, checkPlayImage, downloadKitAsset, imageSize, isPlayPromoVideoUrl, md5Hex, parsePayloadAssets,
  PLAY_IMAGE_TYPES, PLAY_SCREENSHOTS_PER_TYPE, pngHasAlpha, type PayloadAsset, type PlayImageType,
} from './store-media.ts'

// ── App Store Connect ─────────────────────────────────────────────────────────

/** App Store versions whose media can still change. */
const EDITABLE_STATES = new Set(['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'])
const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

interface UploadOperation { method?: string; url?: string; length?: number; offset?: number; requestHeaders?: Array<{ name?: string; value?: string }> }

async function ascSend(ctx: ConnectorContext, key: AscKey, method: string, path: string, body?: unknown): Promise<JsonResponse<any>> {
  return fetchJson<any>(ctx, `${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token(ctx, key)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, 30_000)
}

/** The editable version's localization for `locale`: the id, or a refusal a person can act on. */
async function editableLocalization(ctx: ConnectorContext, key: AscKey, appleId: string, locale: string): Promise<{ id: string; version: string } | string> {
  const v = await asc(ctx, key, `/v1/apps/${appleId}/appStoreVersions?limit=10&fields[appStoreVersions]=versionString,appVersionState,appStoreState`)
  if (isAgreementBlock(v.status, v.body)) return AGREEMENT_BLOCKED_REASON
  if (v.status !== 200) return statusReason('App Store Connect', v.status)
  const editable = ((v.body?.data ?? []) as Array<{ id: string; attributes?: Record<string, string> }>)
    .find((x) => EDITABLE_STATES.has(x.attributes?.appVersionState ?? x.attributes?.appStoreState ?? ''))
  if (!editable) return 'No App Store version can take new media right now. Create the next version in App Store Connect (or wait for review to finish), then approve the upload again.'
  const loc = await asc(ctx, key, `/v1/appStoreVersions/${editable.id}/appStoreVersionLocalizations?limit=50&fields[appStoreVersionLocalizations]=locale`)
  if (loc.status !== 200) return statusReason('App Store Connect', loc.status)
  const hit = ((loc.body?.data ?? []) as Array<{ id: string; attributes?: { locale?: string } }>).find((x) => x.attributes?.locale === locale)
  if (!hit) return `Version ${editable.attributes?.versionString ?? ''} has no ${locale} localization. Add the language in App Store Connect first.`
  return { id: hit.id, version: editable.attributes?.versionString ?? '' }
}

/** The screenshot or preview set for one device type on a localization, created when missing. */
async function mediaSet(ctx: ConnectorContext, key: AscKey, kind: 'screenshot' | 'preview', localizationId: string, deviceType: string): Promise<{ id: string; existing: number } | string> {
  const rel = kind === 'screenshot' ? 'appScreenshotSets' : 'appPreviewSets'
  const attr = kind === 'screenshot' ? 'screenshotDisplayType' : 'previewType'
  const child = kind === 'screenshot' ? 'appScreenshots' : 'appPreviews'
  const list = await asc(ctx, key, `/v1/appStoreVersionLocalizations/${localizationId}/${rel}?filter[${attr}]=${deviceType}&include=${child}&limit=5`)
  if (list.status !== 200) return statusReason('App Store Connect', list.status)
  const found = (list.body?.data ?? [])[0] as { id: string; relationships?: Record<string, { data?: unknown[] }> } | undefined
  if (found) return { id: found.id, existing: (found.relationships?.[child]?.data ?? []).length }
  const created = await ascSend(ctx, key, 'POST', `/v1/${rel}`, {
    data: { type: rel, attributes: { [attr]: deviceType }, relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: localizationId } } } },
  })
  if (created.status !== 201 || !created.body?.data?.id) return statusReason('App Store Connect', created.status)
  return { id: String(created.body.data.id), existing: 0 }
}

/** Reserve, upload each part, commit with the MD5. Returns the new asset id, or the reason it stopped. */
async function uploadOne(ctx: ConnectorContext, key: AscKey, kind: 'screenshot' | 'preview', setId: string, asset: PayloadAsset, bytes: Uint8Array): Promise<{ id: string } | string> {
  const type = kind === 'screenshot' ? 'appScreenshots' : 'appPreviews'
  const setType = kind === 'screenshot' ? 'appScreenshotSets' : 'appPreviewSets'
  const setRel = kind === 'screenshot' ? 'appScreenshotSet' : 'appPreviewSet'
  const attributes: Record<string, unknown> = { fileName: asset.fileName, fileSize: bytes.length }
  if (kind === 'preview') {
    attributes.mimeType = asset.mime
    if (asset.previewFrameTimeCode) attributes.previewFrameTimeCode = asset.previewFrameTimeCode
  }
  const reserved = await ascSend(ctx, key, 'POST', `/v1/${type}`, { data: { type, attributes, relationships: { [setRel]: { data: { type: setType, id: setId } } } } })
  const id = reserved.body?.data?.id as string | undefined
  const ops = (reserved.body?.data?.attributes?.uploadOperations ?? []) as UploadOperation[]
  if (reserved.status !== 201 || !id || ops.length === 0) return `Apple did not reserve ${asset.fileName}: ${statusReason('App Store Connect', reserved.status)}`
  for (const op of ops) {
    if (!op.url || !op.url.startsWith('https://') || typeof op.offset !== 'number' || typeof op.length !== 'number') return `Apple sent an upload step Mushi cannot follow for ${asset.fileName}.`
    const headers: Record<string, string> = {}
    for (const h of op.requestHeaders ?? []) if (h.name && h.value && h.name.toLowerCase() !== 'authorization') headers[h.name] = h.value
    // The upload URLs are pre-signed and unauthenticated: no JWT goes with them.
    const res = await ctx.fetch(op.url, { method: op.method ?? 'PUT', headers, body: bytes.slice(op.offset, op.offset + op.length) })
    if (!res.ok) return `Uploading ${asset.fileName} to Apple failed (${res.status}).`
  }
  const commit = await ascSend(ctx, key, 'PATCH', `/v1/${type}/${id}`, { data: { type, id, attributes: { uploaded: true, sourceFileChecksum: md5Hex(bytes) } } })
  if (commit.status !== 200) return `Apple did not accept ${asset.fileName} after upload: ${statusReason('App Store Connect', commit.status)}`
  return { id }
}

async function uploadMedia(ctx: ConnectorContext, key: AscKey, action: ApprovedConnectorAction): Promise<ConnectorActionResult> {
  const kind = action.action === 'upload_screenshots' ? 'screenshot' : 'preview'
  const p = action.payload as { appleId?: string; locale?: string; displayType?: string; previewType?: string; assets?: unknown }
  if (typeof p.appleId !== 'string' || !/^\d{6,12}$/.test(p.appleId)) return { ok: false, detail: 'The payload has no valid Apple app id.' }
  if (typeof p.locale !== 'string' || !LOCALE.test(p.locale)) return { ok: false, detail: 'The payload has no valid locale (e.g. en-US).' }
  const deviceType = kind === 'screenshot' ? p.displayType : p.previewType
  const sizes = kind === 'screenshot' ? APPLE_SCREENSHOT_SIZES : APPLE_PREVIEW_SIZES
  if (typeof deviceType !== 'string' || !sizes[deviceType]) return { ok: false, detail: `The payload has no supported ${kind === 'screenshot' ? 'displayType' : 'previewType'}.` }
  const max = kind === 'screenshot' ? APPLE_SCREENSHOTS_PER_SET : APPLE_PREVIEW.perSet
  const assets = parsePayloadAssets(p.assets, max)
  if (typeof assets === 'string') return { ok: false, detail: assets }
  const outside = assetsOutsideKit(assets, ctx.projectId, (action.payload as { kitId?: unknown }).kitId)
  if (outside) return { ok: false, detail: outside }
  for (const a of assets) {
    const okMime = kind === 'screenshot' ? ['image/png', 'image/jpeg'].includes(a.mime) : APPLE_PREVIEW.mimes.includes(a.mime)
    if (!okMime) return { ok: false, detail: `${a.fileName} is ${a.mime}; ${kind === 'screenshot' ? 'screenshots are PNG or JPEG' : 'app previews are .mov, .m4v or .mp4 (H.264 or ProRes 422 HQ)'}.` }
    if (kind === 'preview' && a.bytes > APPLE_PREVIEW.maxBytes) return { ok: false, detail: `${a.fileName} is over 100 MB.` }
  }
  // Every byte is read and re-hashed before anything is sent to Apple.
  const files: Array<{ asset: PayloadAsset; bytes: Uint8Array }> = []
  for (const a of assets) {
    const got = await downloadKitAsset(ctx.db, a)
    if (!got.ok) return { ok: false, detail: got.detail }
    files.push({ asset: a, bytes: got.bytes })
  }
  const loc = await editableLocalization(ctx, key, p.appleId, p.locale)
  if (typeof loc === 'string') return { ok: false, detail: loc }
  const set = await mediaSet(ctx, key, kind, loc.id, deviceType)
  if (typeof set === 'string') return { ok: false, detail: set }
  if (set.existing + files.length > max) return { ok: false, detail: `The ${deviceType} set already has ${set.existing}; Apple takes at most ${max}. Remove some in App Store Connect first.` }
  const uploaded: string[] = []
  for (const f of files) {
    const r = await uploadOne(ctx, key, kind, set.id, f.asset, f.bytes)
    if (typeof r === 'string') return { ok: false, detail: uploaded.length ? `${r} (${uploaded.length} of ${files.length} were uploaded before it stopped.)` : r, result: { setId: set.id, uploaded } }
    uploaded.push(r.id)
  }
  return { ok: true, detail: `Uploaded ${uploaded.length} ${kind === 'screenshot' ? 'screenshot' : 'app preview'}${uploaded.length === 1 ? '' : 's'} to version ${loc.version} (${p.locale}, ${deviceType}). Apple processes them next.`, result: { setId: set.id, uploaded, version: loc.version } }
}

// ── Google Play ───────────────────────────────

const UPLOAD_API = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications'
const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

/**
 * `upload_listing_images`: { package, language, imageType, assets, replace? }
 *   Each asset is downloaded and re-hashed, its size and format checked
 *   against Play's rules, then uploaded with edits.images.upload (media
 *   upload base) inside one edit that is committed only when all succeed.
 *   `replace: true` first clears that image type for the language (deleteall).
 * `set_promo_video`: { package, language, youtubeUrl }
 *   Play's listing `video` field is a YouTube URL; Play takes no video file.
 */
async function playListingMedia(ctx: ConnectorContext, sa: ServiceAccount, pkg: string, action: ApprovedConnectorAction): Promise<ConnectorActionResult> {
  const p = action.payload as { language?: string; imageType?: string; assets?: unknown; replace?: unknown; youtubeUrl?: unknown }
  if (typeof p.language !== 'string' || !LANGUAGE.test(p.language)) return { ok: false, detail: 'The payload has no valid language (e.g. en-US).' }
  const files: Array<{ fileName: string; mime: string; bytes: Uint8Array }> = []
  let imageType: PlayImageType | null = null
  if (action.action === 'upload_listing_images') {
    if (typeof p.imageType !== 'string' || !(PLAY_IMAGE_TYPES as readonly string[]).includes(p.imageType)) return { ok: false, detail: 'The payload has no valid imageType (phoneScreenshots, featureGraphic, …).' }
    imageType = p.imageType as PlayImageType
    const single = imageType === 'icon' || imageType === 'featureGraphic' || imageType === 'tvBanner'
    const assets = parsePayloadAssets(p.assets, single ? 1 : PLAY_SCREENSHOTS_PER_TYPE)
    if (typeof assets === 'string') return { ok: false, detail: assets }
    const outside = assetsOutsideKit(assets, ctx.projectId, (action.payload as { kitId?: unknown }).kitId)
    if (outside) return { ok: false, detail: outside }
    // Every byte is read, re-hashed and checked before anything is sent to Google.
    for (const a of assets) {
      const got = await downloadKitAsset(ctx.db, a)
      if (!got.ok) return { ok: false, detail: got.detail }
      const size = imageSize(got.bytes)
      const failed = checkPlayImage(imageType, { mime: a.mime, bytes: got.bytes.length, width: size?.width ?? null, height: size?.height ?? null, durationMs: null, fps: null, codec: null, metadataFrom: 'measured', hasAlpha: a.mime === 'image/png' ? pngHasAlpha(got.bytes) : null })
        .find((c) => c.state === 'fail' || c.state === 'unknown')
      if (failed) return { ok: false, detail: `${a.fileName}: ${failed.detail}` }
      files.push({ fileName: a.fileName, mime: a.mime, bytes: got.bytes })
    }
  } else if (!isPlayPromoVideoUrl(p.youtubeUrl)) {
    return { ok: false, detail: 'set_promo_video needs a single YouTube video URL (no playlist, no timecode).' }
  }
  const t = await accessToken(ctx, sa)
  const edit = await api(ctx, t, 'POST', `/${pkg}/edits`)
  if (edit.status !== 200 || !edit.body?.id) return { ok: false, detail: statusReason('Google Play', edit.status) }
  const editId = String(edit.body.id)
  try {
    if (action.action === 'set_promo_video') {
      const patch = await api(ctx, t, 'PATCH', `/${pkg}/edits/${editId}/listings/${p.language}`, { video: p.youtubeUrl })
      if (patch.status !== 200) return { ok: false, detail: statusReason('Google Play', patch.status) }
    } else {
      if (p.replace === true) {
        const cleared = await api(ctx, t, 'DELETE', `/${pkg}/edits/${editId}/listings/${p.language}/${imageType}`)
        if (cleared.status !== 200 && cleared.status !== 204) return { ok: false, detail: statusReason('Google Play', cleared.status) }
      }
      for (const f of files) {
        const res = await ctx.fetch(`${UPLOAD_API}/${pkg}/edits/${editId}/listings/${p.language}/${imageType}?uploadType=media`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${t}`, 'Content-Type': f.mime },
          body: f.bytes as Uint8Array<ArrayBuffer>,
        })
        if (!res.ok) return { ok: false, detail: `${f.fileName}: ${statusReason('Google Play', res.status)} Nothing was published.` }
      }
    }
    const commit = await api(ctx, t, 'POST', `/${pkg}/edits/${editId}:commit`)
    if (commit.status !== 200) return { ok: false, detail: statusReason('Google Play', commit.status) }
    return action.action === 'set_promo_video'
      ? { ok: true, detail: `Set the ${p.language} promo video.`, result: { editId, language: p.language } }
      : { ok: true, detail: `Uploaded ${(p.assets as unknown[]).length} ${imageType} image${(p.assets as unknown[]).length === 1 ? '' : 's'} for ${p.language} and committed the edit.`, result: { editId, language: p.language, imageType } }
  } finally {
    await api(ctx, t, 'DELETE', `/${pkg}/edits/${editId}`).catch(() => {})
  }
}

async function appStoreMediaAct(ctx: ConnectorContext, action: ApprovedConnectorAction): Promise<ConnectorActionResult> {
  const key = parseKey(ctx.writeCredential)
  if (!key) return { ok: false, detail: 'No write key is stored for App Store Connect (a key with the App Manager role).' }
  return uploadMedia(ctx, key, action)
}

async function playMediaAct(ctx: ConnectorContext, action: ApprovedConnectorAction): Promise<ConnectorActionResult> {
  const sa = parseSa(ctx.writeCredential)
  if (!sa) return { ok: false, detail: 'No write key is stored for Google Play.' }
  const pkg = (action.payload as { package?: unknown }).package
  if (typeof pkg !== 'string' || !PKG.test(pkg)) return { ok: false, detail: 'The payload has no valid package name.' }
  return playListingMedia(ctx, sa, pkg, action)
}

/** What api-ext's release-kit execute route injects as ExecuteDeps.storeMedia. */
export const storeMediaActs: StoreMediaActs = { appStore: appStoreMediaAct, play: playMediaAct }
