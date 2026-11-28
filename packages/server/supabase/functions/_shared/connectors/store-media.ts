/**
 * FILE: packages/server/supabase/functions/_shared/connectors/store-media.ts
 * PURPOSE: Store media (Plan 025 P6, ADR 0074): the App Store and Google
 *          Play specs for screenshots, app previews and listing images, the
 *          checks a release kit shows inline, and the one way a connector's
 *          act() reads a kit asset (download, then re-hash against the
 *          approved payload, so an approval covers the exact bytes).
 *
 * Specs read 2026-11-27 from:
 *   developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications
 *   developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
 *   developer.apple.com/documentation/appstoreconnectapi/screenshotdisplaytype, …/previewtype
 *   support.google.com/googleplay/android-developer/answer/9866151
 *   developers.google.com/android-publisher/api-ref/rest/v3/AppImageType, …/edits.listings
 *
 * Pure except downloadKitAsset (storage read). No Deno globals.
 */

export const RELEASE_KITS_BUCKET = 'release-kits'

export interface Size { width: number; height: number }

// ── image size (measured, never declared) ────────────────────────────────────

/** Width and height of a PNG (IHDR) or JPEG (first SOFn) file; null for anything else. */
export function imageSize(bytes: Uint8Array): Size | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { width: v.getUint32(16), height: v.getUint32(20) }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue }
      const marker = bytes[i + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
      const len = (bytes[i + 2] << 8) | bytes[i + 3]
      // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] }
      }
      i += 2 + len
    }
  }
  return null
}

/** True when a PNG carries an alpha channel (colour type 4 or 6). Play wants 24-bit PNGs with no alpha. */
export function pngHasAlpha(bytes: Uint8Array): boolean | null {
  if (bytes.length < 26 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null
  const colorType = bytes[25]
  return colorType === 4 || colorType === 6
}

// ── hashes ───────────────────────────────────────────────────────────────────

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  // TS 6 types a plain Uint8Array as possibly SharedArrayBuffer-backed; digest wants an ArrayBuffer view.
  const buf = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21]
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0)

/**
 * MD5 (RFC 1321) of the whole file, hex. App Store Connect's upload commit
 * takes `sourceFileChecksum` as MD5, and WebCrypto has no MD5. Integrity
 * only, never security: the approval binds SHA-256.
 */
export function md5Hex(bytes: Uint8Array): string {
  const bitLen = bytes.length * 8
  const padded = new Uint8Array((((bytes.length + 8) >>> 6) + 1) << 6)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const dv = new DataView(padded.buffer)
  dv.setUint32(padded.length - 8, bitLen >>> 0, true)
  dv.setUint32(padded.length - 4, Math.floor(bitLen / 2 ** 32), true)
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
  for (let off = 0; off < padded.length; off += 64) {
    let a = a0, b = b0, c = c0, d = d0
    for (let i = 0; i < 64; i++) {
      let f: number, g: number
      if (i < 16) { f = (b & c) | (~b & d); g = i }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16 }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16 }
      else { f = c ^ (b | ~d); g = (7 * i) % 16 }
      const tmp = d
      d = c
      c = b
      const x = (a + f + MD5_K[i] + dv.getUint32(off + g * 4, true)) >>> 0
      b = (b + ((x << MD5_S[i]) | (x >>> (32 - MD5_S[i])))) >>> 0
      a = tmp
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0
  }
  const out = new Uint8Array(16)
  const ov = new DataView(out.buffer)
  ov.setUint32(0, a0, true); ov.setUint32(4, b0, true); ov.setUint32(8, c0, true); ov.setUint32(12, d0, true)
  return [...out].map((x) => x.toString(16).padStart(2, '0')).join('')
}

// ── specs ────────────────────────────────────────────────────────────────────

const both = (sizes: Array<[number, number]>): Size[] => sizes.flatMap(([w, h]) => [{ width: w, height: h }, { width: h, height: w }])
const only = (sizes: Array<[number, number]>): Size[] => sizes.map(([w, h]) => ({ width: w, height: h }))

/** App Store screenshot display types Mushi uploads, with the sizes Apple accepts for each. */
export const APPLE_SCREENSHOT_SIZES: Record<string, Size[]> = {
  APP_IPHONE_67: both([[1260, 2736], [1290, 2796], [1320, 2868]]),
  APP_IPHONE_65: both([[1284, 2778], [1242, 2688]]),
  APP_IPHONE_61: both([[1179, 2556], [1206, 2622]]),
  APP_IPHONE_55: both([[1242, 2208]]),
  APP_IPAD_PRO_3GEN_129: both([[2064, 2752], [2048, 2732]]),
  APP_IPAD_PRO_129: both([[2048, 2732]]),
  APP_IPAD_PRO_3GEN_11: both([[1488, 2266], [1512, 2316], [1668, 2420], [1668, 2388], [1640, 2360]]),
}
export const APPLE_SCREENSHOTS_PER_SET = 10

/** App preview types with the accepted (not device) resolutions. */
export const APPLE_PREVIEW_SIZES: Record<string, Size[]> = {
  IPHONE_67: both([[886, 1920]]),
  IPHONE_65: both([[886, 1920]]),
  IPHONE_61: both([[886, 1920]]),
  IPHONE_58: both([[886, 1920]]),
  IPHONE_55: both([[1080, 1920]]),
  IPHONE_47: both([[750, 1334]]),
  IPAD_PRO_3GEN_129: both([[1200, 1600]]),
  IPAD_PRO_3GEN_11: both([[1200, 1600]]),
  IPAD_PRO_129: both([[1200, 1600], [900, 1200]]),
  IPAD_105: both([[1200, 1600]]),
  IPAD_97: both([[900, 1200]]),
  DESKTOP: only([[1920, 1080]]),
  APPLE_TV: only([[1920, 1080]]),
  APPLE_VISION_PRO: only([[3840, 2160]]),
}
export const APPLE_PREVIEW = {
  minSeconds: 15,
  maxSeconds: 30,
  maxFps: 30,
  mimes: ['video/mp4', 'video/quicktime'] as readonly string[],
  /** Apple's limit is 500 MB; a kit object is at most 100 MB, and act() reads it into memory. */
  maxBytes: 100 * 1024 * 1024,
  perSet: 3,
  codecs: ['h264', 'prores'] as readonly string[],
}

export const PLAY_IMAGE_TYPES = ['phoneScreenshots', 'sevenInchScreenshots', 'tenInchScreenshots', 'tvScreenshots', 'wearScreenshots', 'icon', 'featureGraphic', 'tvBanner'] as const
export type PlayImageType = (typeof PLAY_IMAGE_TYPES)[number]
export const PLAY_SCREENSHOTS_PER_TYPE = 8
export const PLAY_SCREENSHOT_MAX_BYTES = 8 * 1024 * 1024
const PLAY_FIXED: Partial<Record<PlayImageType, Size>> = {
  icon: { width: 512, height: 512 },
  featureGraphic: { width: 1024, height: 500 },
  tvBanner: { width: 1280, height: 720 },
}

export type CheckState = 'pass' | 'fail' | 'declared' | 'unknown'
export interface SpecCheck { id: string; label: string; state: CheckState; detail: string }

export interface MediaFacts {
  mime: string
  bytes: number | null
  width: number | null
  height: number | null
  durationMs: number | null
  fps: number | null
  codec: string | null
  /** 'measured' when width/height were read from the file; video metadata is always declared. */
  metadataFrom: 'measured' | 'declared'
  hasAlpha?: boolean | null
}

const fits = (s: Size[], w: number, h: number) => s.some((x) => x.width === w && x.height === h)
const list = (s: Size[]) => [...new Set(s.map((x) => `${x.width}×${x.height}`))].slice(0, 6).join(', ')

function sizeCheck(id: string, accepted: Size[], f: MediaFacts): SpecCheck {
  if (f.width == null || f.height == null) return { id, label: 'Size', state: 'unknown', detail: `Needs one of ${list(accepted)}.` }
  const ok = fits(accepted, f.width, f.height)
  return { id, label: 'Size', state: ok ? (f.metadataFrom === 'measured' ? 'pass' : 'declared') : 'fail', detail: ok ? `${f.width}×${f.height}` : `${f.width}×${f.height}; App Store accepts ${list(accepted)}.` }
}

/** Checks for one App Store screenshot. */
export function checkAppleScreenshot(displayType: string, f: MediaFacts): SpecCheck[] {
  const sizes = APPLE_SCREENSHOT_SIZES[displayType]
  if (!sizes) return [{ id: 'display_type', label: 'Device', state: 'fail', detail: `Unknown screenshot display type ${displayType}.` }]
  return [
    { id: 'format', label: 'Format', state: ['image/png', 'image/jpeg'].includes(f.mime) ? 'pass' : 'fail', detail: ['image/png', 'image/jpeg'].includes(f.mime) ? f.mime.replace('image/', '').toUpperCase() : 'PNG or JPEG only.' },
    sizeCheck('size', sizes, f),
  ]
}

/** Checks for one App Store app preview (15–30 s, H.264 or ProRes 422 HQ, ≤ 30 fps). */
export function checkApplePreview(previewType: string, f: MediaFacts): SpecCheck[] {
  const sizes = APPLE_PREVIEW_SIZES[previewType]
  if (!sizes) return [{ id: 'preview_type', label: 'Device', state: 'fail', detail: `Unknown preview type ${previewType}.` }]
  const secs = f.durationMs != null ? f.durationMs / 1000 : null
  const checks: SpecCheck[] = [
    { id: 'format', label: 'Container', state: APPLE_PREVIEW.mimes.includes(f.mime) ? 'pass' : 'fail', detail: APPLE_PREVIEW.mimes.includes(f.mime) ? f.mime : '.mov, .m4v or .mp4 only (a WebM clip is source footage, not a preview).' },
    f.codec == null
      ? { id: 'codec', label: 'Codec', state: 'unknown', detail: 'H.264, or ProRes 422 HQ in .mov.' }
      : { id: 'codec', label: 'Codec', state: APPLE_PREVIEW.codecs.some((c) => f.codec!.toLowerCase().includes(c)) ? 'declared' : 'fail', detail: f.codec },
    secs == null
      ? { id: 'duration', label: 'Length', state: 'unknown', detail: '15–30 seconds.' }
      : { id: 'duration', label: 'Length', state: secs >= APPLE_PREVIEW.minSeconds && secs <= APPLE_PREVIEW.maxSeconds ? 'declared' : 'fail', detail: `${secs.toFixed(1)} s (15–30 s).` },
    f.fps == null
      ? { id: 'fps', label: 'Frame rate', state: 'unknown', detail: 'At most 30 fps.' }
      : { id: 'fps', label: 'Frame rate', state: f.fps <= APPLE_PREVIEW.maxFps ? 'declared' : 'fail', detail: `${f.fps} fps (≤ 30).` },
    sizeCheck('size', sizes, f),
    f.bytes == null
      ? { id: 'bytes', label: 'File size', state: 'unknown', detail: 'At most 100 MB here (Apple allows 500 MB).' }
      : { id: 'bytes', label: 'File size', state: f.bytes <= APPLE_PREVIEW.maxBytes ? 'pass' : 'fail', detail: `${(f.bytes / 1048576).toFixed(1)} MB` },
  ]
  return checks
}

/** Checks for one Google Play listing image. */
export function checkPlayImage(imageType: PlayImageType, f: MediaFacts): SpecCheck[] {
  const fmtOk = imageType === 'icon' ? f.mime === 'image/png' : ['image/png', 'image/jpeg'].includes(f.mime)
  const checks: SpecCheck[] = [{ id: 'format', label: 'Format', state: fmtOk ? 'pass' : 'fail', detail: fmtOk ? f.mime.replace('image/', '').toUpperCase() : imageType === 'icon' ? '32-bit PNG only.' : 'JPEG or 24-bit PNG only.' }]
  if (imageType !== 'icon' && f.mime === 'image/png' && f.hasAlpha === true) checks.push({ id: 'alpha', label: 'Alpha', state: 'fail', detail: 'Play wants a 24-bit PNG with no alpha channel.' })
  const fixed = PLAY_FIXED[imageType]
  if (f.width == null || f.height == null) {
    checks.push({ id: 'size', label: 'Size', state: 'unknown', detail: fixed ? `${fixed.width}×${fixed.height}` : 'Each side 320–3840 px.' })
    return checks
  }
  if (fixed) {
    const ok = f.width === fixed.width && f.height === fixed.height
    checks.push({ id: 'size', label: 'Size', state: ok ? 'pass' : 'fail', detail: ok ? `${f.width}×${f.height}` : `${f.width}×${f.height}; needs ${fixed.width}×${fixed.height}.` })
  } else {
    const long = Math.max(f.width, f.height)
    const short = Math.min(f.width, f.height)
    const ok = short >= 320 && long <= 3840 && long <= short * 2.3
    checks.push({ id: 'size', label: 'Size', state: ok ? 'pass' : 'fail', detail: ok ? `${f.width}×${f.height}` : `${f.width}×${f.height}; each side 320–3840 px, the long side at most 2.3× the short.` })
    if (f.bytes != null) checks.push({ id: 'bytes', label: 'File size', state: f.bytes <= PLAY_SCREENSHOT_MAX_BYTES ? 'pass' : 'fail', detail: `${(f.bytes / 1048576).toFixed(1)} MB (≤ 8 MB)` })
  }
  return checks
}

/** A YouTube video URL as Play's listing `video` field takes it: a single video, no playlist, no timecode. */
export function isPlayPromoVideoUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 200) return false
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    if (u.searchParams.has('list') || u.searchParams.has('t')) return false
    if ((u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') && u.pathname === '/watch') return /^[\w-]{11}$/.test(u.searchParams.get('v') ?? '')
    if (u.hostname === 'youtu.be') return /^\/[\w-]{11}$/.test(u.pathname) && u.search === ''
    return false
  } catch {
    return false
  }
}

// ── reading an approved asset ────────────────────────────────────────────────

/** One kit asset as an approved store-upload payload names it. */
export interface PayloadAsset {
  path: string
  sha256: string
  bytes: number
  mime: string
  fileName: string
  /** App previews: the poster frame, "00:00:05:00". */
  previewFrameTimeCode?: string
}

const ASSET_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[\w.-]{1,120}$/i

/** Validate the assets array of a store payload (shape only; bytes are checked on download). */
export function parsePayloadAssets(raw: unknown, max: number): PayloadAsset[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'The payload names no assets.'
  if (raw.length > max) return `At most ${max} assets in one upload.`
  const out: PayloadAsset[] = []
  for (const a of raw as Array<Record<string, unknown>>) {
    if (typeof a?.path !== 'string' || !ASSET_PATH.test(a.path)) return 'An asset path is not a release-kit path.'
    if (typeof a.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.sha256)) return 'An asset has no sha256.'
    if (typeof a.bytes !== 'number' || a.bytes <= 0 || a.bytes > 104857600) return 'An asset has no valid size.'
    if (typeof a.mime !== 'string' || typeof a.fileName !== 'string' || !/^[\w.-]{1,120}$/.test(a.fileName)) return 'An asset has no valid file name or type.'
    if (a.previewFrameTimeCode !== undefined && (typeof a.previewFrameTimeCode !== 'string' || !/^\d{2}:\d{2}:\d{2}:\d{2}$/.test(a.previewFrameTimeCode))) return 'previewFrameTimeCode must look like 00:00:05:00.'
    out.push({ path: a.path, sha256: a.sha256, bytes: a.bytes, mime: a.mime, fileName: a.fileName, ...(typeof a.previewFrameTimeCode === 'string' ? { previewFrameTimeCode: a.previewFrameTimeCode } : {}) })
  }
  return out
}

/**
 * Every asset of an approved payload must sit in this app's kit folder
 * (`<projectId>/<kitId>/…`). The bucket is shared and act() reads it with the
 * service role, so a payload naming another app's object is refused.
 */
export function assetsOutsideKit(assets: readonly PayloadAsset[], projectId: string | null, kitId: unknown): string | null {
  if (!projectId || typeof kitId !== 'string' || !/^[0-9a-f-]{36}$/i.test(kitId)) return 'The payload names no release kit of this app.'
  const prefix = `${projectId}/${kitId}/`
  const stray = assets.find((a) => !a.path.startsWith(prefix))
  return stray ? `${stray.fileName} is not in this app's release kit. Nothing was uploaded.` : null
}

// deno-lint-ignore no-explicit-any
type StorageDb = { storage?: { from: (bucket: string) => { download: (path: string) => Promise<{ data: Blob | null; error: { message?: string } | null }> } } } | any

/**
 * Download one approved asset from the release-kits bucket and prove it is
 * the file the approver saw: same size, same SHA-256. Anything else is a
 * refusal, never a partial upload.
 */
export async function downloadKitAsset(db: StorageDb, asset: PayloadAsset): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; detail: string }> {
  const storage = (db as { storage?: { from: (b: string) => { download: (p: string) => Promise<{ data: Blob | null; error: { message?: string } | null }> } } }).storage
  if (!storage) return { ok: false, detail: 'Storage is not available to read the asset.' }
  const { data, error } = await storage.from(RELEASE_KITS_BUCKET).download(asset.path)
  if (error || !data) return { ok: false, detail: `${asset.fileName} could not be read from the release kit.` }
  const bytes = new Uint8Array(await data.arrayBuffer())
  if (bytes.length !== asset.bytes) return { ok: false, detail: `${asset.fileName} changed size after it was approved. Nothing was uploaded.` }
  if (await sha256Bytes(bytes) !== asset.sha256) return { ok: false, detail: `${asset.fileName} changed after it was approved. Nothing was uploaded.` }
  return { ok: true, bytes }
}
