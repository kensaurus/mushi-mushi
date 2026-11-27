/**
 * FILE: packages/server/supabase/functions/_shared/release-kit-db.ts
 * PURPOSE: The release kit (Plan 025 P5, ADR 0074), database and storage
 *          part: one kit per release, its before/after screenshots copied
 *          from the UX baselines, clips and recordings uploaded through
 *          signed URLs, and the export a product-video tool reads.
 *
 * Baselines. Plan 025 P1 adds `ux_baselines` (one pinned capture per surface
 * per release, exempt from the retention sweep), built in a sibling branch.
 * This file reads it through BaselineSource and, while that table is not
 * there, falls back to the newest `ux_surfaces` before/after thumbnails in
 * the release's window. Either way the images are COPIED into the
 * release-kits bucket, so the 30-day ux-captures sweep never empties a kit.
 *
 * ux_baselines is P1's table (loop-timeline branch, migration
 * 20261127130000_ux_timeline.sql): one pinned capture per (project,
 * surface_key, viewport, version), with path, label, release_id (or just the
 * version label once the release row is gone), capture_path (a copy under
 * <project>/baselines/ in ux-captures), score and created_at. A screen is
 * matched to a release by release_id, else by its version label.
 */

import { RELEASE_KITS_BUCKET, imageSize, sha256Bytes } from './connectors/store-media.ts'
import {
  brandFrom,
  changelogLines,
  buildManifest,
  KIT_EXPORT_TTL_SEC,
  kitAssetPath,
  MAX_KIT_SCREENSHOT_PAIRS,
  MAX_KIT_VIDEOS,
  type KitAssetKind,
  type KitAssetRow,
  type KitBrand,
  type KitMime,
  type KitPreset,
  type ReleaseKitManifest,
} from './release-kit.ts'

const UX_CAPTURES_BUCKET = 'ux-captures'

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any; storage?: any }

export class KitMigrationPending extends Error {
  constructor() {
    super('The release kit tables are not applied yet (migration 20261127140000_security_proof_release_kits).')
    this.name = 'KitMigrationPending'
  }
}

const missing = (e: { code?: string } | null | undefined) => !!e && ['42P01', 'PGRST205', '42703', 'PGRST204'].includes(e.code ?? '')

export interface KitRow {
  id: string
  release_id: string
  project_id: string
  preset: KitPreset
  brand: Partial<KitBrand>
  changelog: string[]
  manifest: ReleaseKitManifest | null
  exported_at: string | null
  export_count: number
  updated_at: string
}

export interface KitRelease {
  id: string
  project_id: string
  version: string
  title: string
  body_md: string
  status: string
  published_at: string | null
  created_at: string
  commit_sha: string | null
}

export interface KitSettings {
  clipsEnabled: boolean
  clipMaxSeconds: number
  clipMaxMb: number
}

const ASSET_COLS = 'id, kind, source, storage_path, mime, bytes, sha256, width, height, duration_ms, fps, codec, metadata_from, platform, surface_path, viewport, label, status, created_at'

export async function loadKitSettings(db: Db, projectId: string): Promise<KitSettings> {
  const { data } = await db.from('project_settings').select('release_kit_clips_enabled, release_kit_clip_max_seconds, release_kit_clip_max_mb').eq('project_id', projectId).maybeSingle()
  const s = (data ?? {}) as { release_kit_clips_enabled?: boolean; release_kit_clip_max_seconds?: number; release_kit_clip_max_mb?: number }
  return { clipsEnabled: s.release_kit_clips_enabled === true, clipMaxSeconds: s.release_kit_clip_max_seconds ?? 30, clipMaxMb: s.release_kit_clip_max_mb ?? 25 }
}

export async function loadRelease(db: Db, projectId: string, releaseId: string): Promise<KitRelease | null> {
  const { data, error } = await db.from('releases').select('id, project_id, version, title, body_md, status, published_at, created_at, commit_sha').eq('id', releaseId).eq('project_id', projectId).maybeSingle()
  if (missing(error)) throw new KitMigrationPending()
  return (data as KitRelease | null) ?? null
}

/** The release's kit, created on first read with the changelog lines and the project's brand. */
export async function ensureKit(db: Db, release: KitRelease, userId: string | null): Promise<KitRow> {
  const { data: existing, error } = await db.from('release_kits').select('*').eq('release_id', release.id).maybeSingle()
  if (missing(error)) throw new KitMigrationPending()
  if (existing) return existing as KitRow
  const { data: created, error: insErr } = await db.from('release_kits').insert({
    release_id: release.id,
    project_id: release.project_id,
    preset: 'app_store_preview',
    brand: {},
    changelog: changelogLines(release.body_md),
    created_by: userId,
  }).select('*').single()
  if (insErr?.code === '23505') {
    const { data: raced } = await db.from('release_kits').select('*').eq('release_id', release.id).maybeSingle()
    if (raced) return raced as KitRow
  }
  if (missing(insErr)) throw new KitMigrationPending()
  if (insErr || !created) throw new Error(`The release kit could not be created: ${(insErr?.message ?? 'no row').slice(0, 160)}`)
  return created as KitRow
}

export async function kitAssets(db: Db, kitId: string): Promise<KitAssetRow[]> {
  const { data, error } = await db.from('release_kit_assets').select(ASSET_COLS).eq('kit_id', kitId).order('created_at', { ascending: true }).limit(200)
  if (missing(error)) throw new KitMigrationPending()
  return (data ?? []) as KitAssetRow[]
}

export async function kitBrand(db: Db, kit: KitRow): Promise<KitBrand> {
  const [{ data: project }, { data: settings }] = await Promise.all([
    db.from('projects').select('name').eq('id', kit.project_id).maybeSingle(),
    db.from('project_settings').select('sdk_widget_accent, sdk_widget_theme').eq('project_id', kit.project_id).maybeSingle(),
  ])
  return brandFrom({ name: (project as { name?: string } | null)?.name ?? null }, settings as { sdk_widget_accent?: string | null; sdk_widget_theme?: string | null } | null, kit.brand ?? {})
}

// ── baselines ────────────────────────────────────────────────────────────────

export interface BaselineCapture { bucket: string; path: string; score: number | null; capturedAt: string }
export interface BaselinePair {
  surfacePath: string
  /** The screen's own name from ux_baselines.label (Settings, Pricing), when known. */
  label?: string | null
  viewport: string | null
  before: BaselineCapture | null
  after: BaselineCapture | null
  source: 'ux_baseline' | 'ux_surface'
}

/** Where before/after screenshots come from. P1's ux_baselines first, ux_surfaces while it is not applied. */
export interface BaselineSource {
  pairs(db: Db, release: KitRelease, previous: { id: string; version?: string; published_at: string | null } | null): Promise<BaselinePair[] | null>
}

const VIEWPORT_OF = /-(desktop|mobile)\.png$/

/** P1's pinned baselines: this release's capture is "after", the previous release's is "before". Null = table not there. */
export const uxBaselinesSource: BaselineSource = {
  async pairs(db, release, previous) {
    const cols = 'surface_key, path, label, viewport, release_id, version, capture_path, score, created_at'
    const ids = [release.id, ...(previous ? [previous.id] : [])]
    const versions = [release.version, ...(previous?.version ? [previous.version] : [])]
    // A baseline names its release by id, or only by version once the release row is gone.
    const [byId, byVersion] = await Promise.all([
      db.from('ux_baselines').select(cols).eq('project_id', release.project_id).in('release_id', ids).limit(200),
      db.from('ux_baselines').select(cols).eq('project_id', release.project_id).in('version', versions).limit(200),
    ])
    if (byId.error || byVersion.error) return null
    type Row = { surface_key: string; path: string; label: string | null; viewport: string; release_id: string | null; version: string; capture_path: string; score: number | null; created_at: string }
    const rows = new Map<string, Row>()
    for (const r of [...(byId.data ?? []), ...(byVersion.data ?? [])] as Row[]) rows.set(`${r.surface_key}|${r.viewport}|${r.version}|${r.release_id ?? ''}`, r)
    const isThis = (r: Row) => r.release_id === release.id || (!r.release_id && r.version === release.version)
    const isPrev = (r: Row) => !!previous && (r.release_id === previous.id || (!r.release_id && r.version === previous.version))
    const by = new Map<string, BaselinePair>()
    // Oldest first, so the newest capture of a screen wins its slot.
    for (const r of [...rows.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      if (!isThis(r) && !isPrev(r)) continue
      const k = `${r.surface_key}|${r.viewport}`
      const pair = by.get(k) ?? { surfacePath: r.path, label: r.label, viewport: r.viewport, before: null, after: null, source: 'ux_baseline' as const }
      const cap = { bucket: UX_CAPTURES_BUCKET, path: r.capture_path, score: r.score, capturedAt: r.created_at }
      if (isThis(r)) pair.after = cap
      else pair.before = cap
      by.set(k, pair)
    }
    return [...by.values()].filter((p) => p.after).slice(0, MAX_KIT_SCREENSHOT_PAIRS)
  },
}

/** Fallback: the newest UX-run screens with before and after shots in the release's window. */
export const uxSurfacesSource: BaselineSource = {
  async pairs(db, release, previous) {
    const until = release.published_at ?? new Date().toISOString()
    const since = previous?.published_at ?? new Date(Date.parse(until) - 30 * 86_400_000).toISOString()
    const { data, error } = await db
      .from('ux_surfaces')
      .select('path, status, thumb_before, thumb_after, score, updated_at')
      .eq('project_id', release.project_id)
      .not('thumb_after', 'is', null)
      .gte('updated_at', since)
      .lte('updated_at', until)
      .order('updated_at', { ascending: false })
      .limit(80)
    if (error) return []
    const rows = (data ?? []) as Array<{ path: string; status: string; thumb_before: string | null; thumb_after: string; score: number | null; updated_at: string }>
    // One pair per screen: the newest accepted change first, else the newest.
    const sorted = [...rows].sort((a, b) => Number(b.status === 'accepted') - Number(a.status === 'accepted'))
    const seen = new Set<string>()
    const out: BaselinePair[] = []
    for (const r of sorted) {
      const viewport = VIEWPORT_OF.exec(r.thumb_after)?.[1] ?? null
      const k = `${r.path}|${viewport ?? ''}`
      if (seen.has(k)) continue
      seen.add(k)
      out.push({
        surfacePath: r.path, viewport, source: 'ux_surface',
        before: r.thumb_before ? { bucket: UX_CAPTURES_BUCKET, path: r.thumb_before, score: null, capturedAt: r.updated_at } : null,
        after: { bucket: UX_CAPTURES_BUCKET, path: r.thumb_after, score: r.score, capturedAt: r.updated_at },
      })
      if (out.length >= MAX_KIT_SCREENSHOT_PAIRS) break
    }
    return out
  },
}

async function previousRelease(db: Db, release: KitRelease): Promise<{ id: string; version: string; published_at: string | null } | null> {
  const { data } = await db
    .from('releases')
    .select('id, version, published_at')
    .eq('project_id', release.project_id)
    .eq('status', 'published')
    .neq('id', release.id)
    .lt('published_at', release.published_at ?? new Date().toISOString())
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as { id: string; version: string; published_at: string | null } | null) ?? null
}

/**
 * Replace the kit's screenshots with copies of the release's before/after
 * baselines. Returns where they came from and how many were copied.
 */
export async function refreshScreenshots(db: Db, kit: KitRow, release: KitRelease, sources: readonly BaselineSource[] = [uxBaselinesSource, uxSurfacesSource]): Promise<{ source: 'ux_baseline' | 'ux_surface' | 'none'; copied: number; skipped: number }> {
  const prev = await previousRelease(db, release)
  let pairs: BaselinePair[] = []
  for (const s of sources) {
    const got = await s.pairs(db, release, prev)
    if (got && got.length) { pairs = got; break }
  }
  // Remove the old copies first (objects, then rows).
  const { data: old } = await db.from('release_kit_assets').select('id, storage_path').eq('kit_id', kit.id).in('source', ['ux_baseline', 'ux_surface'])
  const oldRows = (old ?? []) as Array<{ id: string; storage_path: string }>
  if (oldRows.length) {
    try {
      await db.storage?.from(RELEASE_KITS_BUCKET).remove(oldRows.map((r) => r.storage_path))
    } catch {
      // An orphaned object is harmless; the row is what the kit reads.
    }
    await db.from('release_kit_assets').delete().in('id', oldRows.map((r) => r.id))
  }
  if (!pairs.length) return { source: 'none', copied: 0, skipped: 0 }
  let copied = 0
  let skipped = 0
  let n = 0
  for (const p of pairs) {
    for (const [kind, cap] of [['screenshot_before', p.before], ['screenshot_after', p.after]] as Array<[KitAssetKind, BaselineCapture | null]>) {
      if (!cap) continue
      n++
      const { data: blob, error } = await db.storage.from(cap.bucket).download(cap.path)
      if (error || !blob) { skipped++; continue }
      const bytes = new Uint8Array(await (blob as Blob).arrayBuffer())
      const size = imageSize(bytes)
      const path = kitAssetPath(kit.project_id, kit.id, kind, `${p.surfacePath.replace(/\//g, '-') || 'home'}-${p.viewport ?? 'screen'}.png`, n)
      const up = await db.storage.from(RELEASE_KITS_BUCKET).upload(path, bytes, { contentType: 'image/png', upsert: true })
      if (up.error) { skipped++; continue }
      const { error: insErr } = await db.from('release_kit_assets').insert({
        kit_id: kit.id, project_id: kit.project_id, kind, source: p.source, storage_path: path, mime: 'image/png',
        bytes: bytes.length, sha256: await sha256Bytes(bytes), width: size?.width ?? null, height: size?.height ?? null,
        metadata_from: size ? 'measured' : 'declared', platform: 'web', surface_path: p.surfacePath.slice(0, 500),
        viewport: p.viewport, label: p.label ? p.label.slice(0, 200) : kind === 'screenshot_before' ? `${p.surfacePath} before` : `${p.surfacePath} after`, status: 'ready',
      })
      if (insErr) skipped++
      else copied++
    }
  }
  await db.from('release_kits').update({ updated_at: new Date().toISOString() }).eq('id', kit.id)
  return { source: pairs[0]?.source ?? 'none', copied, skipped }
}

// ── uploads (clips, device recordings, the rendered video) ───────────────────

export interface UploadRequest {
  name: string
  kind: Exclude<KitAssetKind, 'screenshot_before' | 'screenshot_after'> | 'screenshot_after' | 'screenshot_before'
  mime: KitMime
  bytes: number
  source: 'playwright' | 'upload' | 'lazycow'
  platform?: 'web' | 'ios' | 'android' | null
  durationMs?: number | null
  fps?: number | null
  codec?: string | null
  width?: number | null
  height?: number | null
  surfacePath?: string | null
  label?: string | null
}

export type UploadRefusal = { code: 'CLIPS_OFF' | 'TOO_LARGE' | 'TOO_LONG' | 'TOO_MANY' | 'BAD_TYPE'; message: string }

/** Check one upload against the app's caps and opt-ins. Null = allowed. */
export function refuseUpload(u: UploadRequest, settings: KitSettings, existingVideos: number): UploadRefusal | null {
  const video = u.mime.startsWith('video/')
  if (u.kind === 'clip' && u.source === 'playwright' && !settings.clipsEnabled) return { code: 'CLIPS_OFF', message: 'Recording clips is off for this app. Turn on "Record clips for release kits" in the kit first.' }
  if (video && (u.kind === 'screenshot_after' || u.kind === 'screenshot_before')) return { code: 'BAD_TYPE', message: 'A screenshot must be an image.' }
  if (!video && (u.kind === 'clip' || u.kind === 'device_recording' || u.kind === 'product_video')) return { code: 'BAD_TYPE', message: 'A clip, recording or product video must be a video file.' }
  // The rendered video is the store preview itself (a 30 s preview at Apple's 10-12 Mbps is about 40 MB): the bucket's cap, not the clip cap.
  const capMb = !video ? 10 : u.kind === 'product_video' ? 100 : settings.clipMaxMb
  if (u.bytes > capMb * 1024 * 1024) return { code: 'TOO_LARGE', message: `${u.name} is ${(u.bytes / 1048576).toFixed(1)} MB; this kit takes at most ${capMb} MB for it.` }
  if (u.kind === 'clip' && u.durationMs != null && u.durationMs > settings.clipMaxSeconds * 1000 + 500) return { code: 'TOO_LONG', message: `${u.name} is ${(u.durationMs / 1000).toFixed(1)} s; clips are capped at ${settings.clipMaxSeconds} s.` }
  if (video && existingVideos >= MAX_KIT_VIDEOS) return { code: 'TOO_MANY', message: `A kit holds at most ${MAX_KIT_VIDEOS} videos. Remove one first.` }
  return null
}

/** Reserve an asset row and a signed upload URL for it. */
export async function reserveUpload(db: Db, kit: KitRow, u: UploadRequest, n: number): Promise<{ assetId: string; path: string; signedUrl: string }> {
  const path = kitAssetPath(kit.project_id, kit.id, u.kind, u.name, n)
  const { data: signed, error: signErr } = await db.storage.from(RELEASE_KITS_BUCKET).createSignedUploadUrl(path, { upsert: true })
  if (signErr || !signed) throw new Error('Could not mint an upload URL.')
  const { data, error } = await db.from('release_kit_assets').insert({
    kit_id: kit.id, project_id: kit.project_id, kind: u.kind, source: u.source, storage_path: path, mime: u.mime, bytes: u.bytes,
    width: u.width ?? null, height: u.height ?? null, duration_ms: u.durationMs ?? null, fps: u.fps ?? null, codec: u.codec?.slice(0, 40) ?? null,
    metadata_from: 'declared', platform: u.platform ?? null, surface_path: u.surfacePath?.slice(0, 500) ?? null, label: u.label?.slice(0, 200) ?? null,
    status: 'pending',
  }).select('id').single()
  if (error || !data) throw new Error(`The asset could not be reserved: ${(error?.message ?? 'no row').slice(0, 120)}`)
  return { assetId: (data as { id: string }).id, path, signedUrl: (signed as { signedUrl: string }).signedUrl }
}

/**
 * After the client PUT the file: check it is there and the size it said,
 * hash it, and read an image's size from the file. Videos keep their
 * declared metadata (Mushi does not parse video containers).
 */
export async function finalizeAsset(db: Db, kit: KitRow, assetId: string, declaredSha256: string | null): Promise<KitAssetRow | { refused: string }> {
  const { data: row } = await db.from('release_kit_assets').select(ASSET_COLS).eq('id', assetId).eq('kit_id', kit.id).maybeSingle()
  const a = row as KitAssetRow | null
  if (!a) return { refused: 'No such asset in this kit.' }
  const { data: blob, error } = await db.storage.from(RELEASE_KITS_BUCKET).download(a.storage_path)
  if (error || !blob) return { refused: 'The file is not uploaded yet.' }
  const bytes = new Uint8Array(await (blob as Blob).arrayBuffer())
  const sha = await sha256Bytes(bytes)
  if (declaredSha256 && declaredSha256 !== sha) {
    await db.from('release_kit_assets').update({ status: 'rejected' }).eq('id', a.id)
    return { refused: 'The uploaded file does not match the sha256 the uploader sent.' }
  }
  if (a.bytes != null && bytes.length !== a.bytes) {
    await db.from('release_kit_assets').update({ status: 'rejected' }).eq('id', a.id)
    return { refused: `The uploaded file is ${bytes.length} bytes, not the ${a.bytes} declared.` }
  }
  const size = a.mime.startsWith('image/') ? imageSize(bytes) : null
  const patch = {
    status: 'ready', sha256: sha, bytes: bytes.length,
    ...(size ? { width: size.width, height: size.height, metadata_from: 'measured' } : {}),
  }
  const { data: updated } = await db.from('release_kit_assets').update(patch).eq('id', a.id).select(ASSET_COLS).single()
  return (updated as KitAssetRow | null) ?? { ...a, ...patch } as KitAssetRow
}

export async function removeAsset(db: Db, kit: KitRow, assetId: string): Promise<boolean> {
  const { data } = await db.from('release_kit_assets').select('id, storage_path').eq('id', assetId).eq('kit_id', kit.id).maybeSingle()
  const a = data as { id: string; storage_path: string } | null
  if (!a) return false
  await db.storage?.from(RELEASE_KITS_BUCKET).remove([a.storage_path])
  await db.from('release_kit_assets').delete().eq('id', a.id)
  return true
}

/** Short-lived signed URLs for the console's thumbnails and clip previews (asset id → url). */
export async function signAssets(db: Db, assets: readonly KitAssetRow[], ttlSec: number, publicUrl: (u: string) => string): Promise<Map<string, string>> {
  const ready = assets.filter((a) => a.status === 'ready')
  const out = new Map<string, string>()
  if (!ready.length || !db.storage) return out
  const { data } = await db.storage.from(RELEASE_KITS_BUCKET).createSignedUrls(ready.map((a) => a.storage_path), ttlSec)
  for (const s of (data ?? []) as Array<{ path?: string; signedUrl?: string }>) {
    const a = ready.find((x) => x.storage_path === s.path)
    if (a && s.signedUrl) out.set(a.id, publicUrl(s.signedUrl))
  }
  return out
}

/**
 * Export: sign every ready asset for KIT_EXPORT_TTL_SEC, write
 * manifest.json beside them, and return the manifest's signed URL (the
 * kitUrl a video tool takes) with the manifest itself.
 */
export async function exportKit(db: Db, kit: KitRow, release: KitRelease, input: { now: Date; publicUrl: (u: string) => string; securityProof: { state: string; headline: string } | null; returnTo: string; stores?: Array<'app-store' | 'google-play' | 'web'> }): Promise<{ kitUrl: string; expiresAt: string; preset: string; manifest: ReleaseKitManifest }> {
  const assets = await kitAssets(db, kit.id)
  const urls = await signAssets(db, assets, KIT_EXPORT_TTL_SEC, input.publicUrl)
  const brand = await kitBrand(db, kit)
  const { data: project } = await db.from('projects').select('id, name').eq('id', kit.project_id).maybeSingle()
  const manifestPath = `${kit.project_id}/${kit.id}/manifest.json`
  // The manifest's own URL goes inside it, so sign the path first.
  const { data: signed, error: signErr } = await db.storage.from(RELEASE_KITS_BUCKET).createSignedUrl(manifestPath, KIT_EXPORT_TTL_SEC)
  if (signErr || !signed?.signedUrl) throw new Error('Could not sign the kit manifest.')
  const kitUrl = input.publicUrl(signed.signedUrl)
  const manifest = buildManifest({
    kitId: kit.id, now: input.now, ttlSec: KIT_EXPORT_TTL_SEC,
    project: { id: kit.project_id, name: (project as { name?: string } | null)?.name ?? brand.name },
    release: { id: release.id, version: release.version, title: release.title, status: release.status, publishedAt: release.published_at, commitSha: release.commit_sha },
    preset: kit.preset, brand, changelog: kit.changelog ?? [], assets, urls,
    securityProof: input.securityProof, stores: input.stores, kitUrl, returnTo: input.returnTo,
  })
  // The bucket allows application/json for exactly this file; a copy also stays on release_kits.manifest.
  const up = await db.storage.from(RELEASE_KITS_BUCKET).upload(manifestPath, new TextEncoder().encode(JSON.stringify(manifest)), { contentType: 'application/json', upsert: true })
  if (up.error) throw new Error(`The kit manifest could not be written: ${String(up.error.message ?? '').slice(0, 120)}`)
  await db.from('release_kits').update({ manifest, exported_at: input.now.toISOString(), export_count: (kit.export_count ?? 0) + 1, updated_at: input.now.toISOString() }).eq('id', kit.id)
  return { kitUrl, expiresAt: manifest.expiresAt!, preset: manifest.mushi.handoff.args.preset, manifest }
}
