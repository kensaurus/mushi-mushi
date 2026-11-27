/**
 * FILE: packages/server/supabase/functions/_shared/release-kit.ts
 * PURPOSE: The release kit (Plan 025 P5, ADR 0074), pure part: the presets a
 *          kit is built for (App Store preview, Play promo, 9:16 and 1:1
 *          social cuts), the spec checks the console shows inline, the
 *          changelog lines from a release's Markdown, and the manifest a
 *          product-video tool reads: lazycow's `lazycow.release-kit` v1
 *          (its type copied in lazycow-release-kit.ts), plus Mushi's own
 *          fields under `mushi`, for `make_product_video({ kitUrl, preset })`
 *          (docs/integrations/lazycow-release-kit.md).
 *
 * Mushi never renders or transcodes video. A Playwright `recordVideo` clip
 * is WebM source footage for the video tool, never an App Store preview on
 * its own; the checks say so instead of pretending.
 */

import { APPLE_PREVIEW, APPLE_PREVIEW_SIZES, APPLE_SCREENSHOT_SIZES, checkApplePreview, checkAppleScreenshot, checkPlayImage, type MediaFacts, type SpecCheck } from './connectors/store-media.ts'
import type { ReleaseKit, ReleaseKitAsset, ReleaseKitColor, ReleaseKitRecording, ReleaseKitScreen, ReleaseKitViewport } from './lazycow-release-kit.ts'

/** The shared contract with lazycow (lazycow-studio docs/product-kit.schema.json). */
export const RELEASE_KIT_SCHEMA = 'lazycow.release-kit'
export const RELEASE_KIT_VERSION = 1
export const KIT_PRESETS = ['app_store_preview', 'play_promo', 'social_vertical', 'social_square'] as const
export type KitPreset = (typeof KIT_PRESETS)[number]

export const KIT_ASSET_KINDS = ['screenshot_before', 'screenshot_after', 'clip', 'device_recording', 'product_video'] as const
export type KitAssetKind = (typeof KIT_ASSET_KINDS)[number]

export const KIT_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'] as const
export type KitMime = (typeof KIT_MIMES)[number]

/** Screenshot pairs a kit copies from the UX baselines. */
export const MAX_KIT_SCREENSHOT_PAIRS = 12
/** Videos (clips, recordings, the rendered video) per kit. */
export const MAX_KIT_VIDEOS = 12
/** Signed URLs in an exported manifest live this long. */
export const KIT_EXPORT_TTL_SEC = 24 * 3600

export interface PresetSpec {
  id: KitPreset
  label: string
  /** The output the video tool renders, as the target store or channel wants it. */
  output: { width: number; height: number; minSeconds: number; maxSeconds: number; maxFps: number; container: string; codec: string; note: string }
  /** Where the result goes. */
  destination: string
}

export const PRESET_SPECS: Record<KitPreset, PresetSpec> = {
  app_store_preview: {
    id: 'app_store_preview',
    label: 'App Store preview',
    output: { width: 886, height: 1920, minSeconds: APPLE_PREVIEW.minSeconds, maxSeconds: APPLE_PREVIEW.maxSeconds, maxFps: APPLE_PREVIEW.maxFps, container: 'mp4', codec: 'h264', note: 'iPhone 6.9"/6.5" accepted size; up to 3 per language. Audio, if any: stereo AAC 256 kbps.' },
    destination: 'App Store Connect (upload_app_preview, after approval)',
  },
  play_promo: {
    id: 'play_promo',
    label: 'Google Play promo',
    output: { width: 1920, height: 1080, minSeconds: 30, maxSeconds: 120, maxFps: 30, container: 'mp4', codec: 'h264', note: 'Play takes a YouTube URL, not a file: publish it to YouTube, then set it with set_promo_video.' },
    destination: 'YouTube, then Google Play (set_promo_video, after approval)',
  },
  social_vertical: {
    id: 'social_vertical',
    label: 'Social 9:16',
    output: { width: 1080, height: 1920, minSeconds: 6, maxSeconds: 60, maxFps: 30, container: 'mp4', codec: 'h264', note: 'Reels, Shorts, TikTok. Burn captions in; most people watch muted.' },
    destination: 'lazycow publish_reel (approval first)',
  },
  social_square: {
    id: 'social_square',
    label: 'Social 1:1',
    output: { width: 1080, height: 1080, minSeconds: 6, maxSeconds: 60, maxFps: 30, container: 'mp4', codec: 'h264', note: 'Feeds (X, LinkedIn, Bluesky).' },
    destination: 'lazycow publish_reel (approval first)',
  },
}

export interface KitAssetRow {
  id: string
  kind: KitAssetKind
  source: 'ux_baseline' | 'ux_surface' | 'playwright' | 'upload' | 'lazycow'
  storage_path: string
  mime: KitMime
  bytes: number | null
  sha256: string | null
  width: number | null
  height: number | null
  duration_ms: number | null
  fps: number | null
  codec: string | null
  metadata_from: 'measured' | 'declared'
  platform: 'web' | 'ios' | 'android' | null
  surface_path: string | null
  viewport: string | null
  label: string | null
  status: 'pending' | 'ready' | 'rejected'
  created_at: string
}

export const factsOf = (a: KitAssetRow): MediaFacts => ({
  mime: a.mime,
  bytes: a.bytes,
  width: a.width,
  height: a.height,
  durationMs: a.duration_ms,
  fps: a.fps,
  codec: a.codec,
  metadataFrom: a.metadata_from,
})

const nearestAppleScreenshotType = (w: number, h: number): string | null =>
  Object.entries(APPLE_SCREENSHOT_SIZES).find(([, sizes]) => sizes.some((s) => s.width === w && s.height === h))?.[0] ?? null

const nearestApplePreviewType = (w: number, h: number): string | null =>
  Object.entries(APPLE_PREVIEW_SIZES).find(([, sizes]) => sizes.some((s) => s.width === w && s.height === h))?.[0] ?? null

const isVideo = (a: Pick<KitAssetRow, 'mime'>) => a.mime.startsWith('video/')

/**
 * Inline checks for one asset under the chosen preset: what the store or
 * channel will refuse, measured where Mushi read the file and `declared`
 * where only the uploader said so.
 */
export function checkAsset(a: KitAssetRow, preset: KitPreset): { usableAs: string | null; checks: SpecCheck[] } {
  const f = factsOf(a)
  if (!isVideo(a)) {
    if (preset === 'play_promo') {
      return { usableAs: 'phoneScreenshots', checks: checkPlayImage('phoneScreenshots', f) }
    }
    const type = a.width && a.height ? nearestAppleScreenshotType(a.width, a.height) : null
    if (preset === 'app_store_preview') {
      return {
        usableAs: type,
        checks: type
          ? checkAppleScreenshot(type, f)
          : [{ id: 'size', label: 'App Store size', state: a.width ? 'fail' : 'unknown', detail: a.width ? `${a.width}×${a.height} is source material for the video, not an App Store screenshot size.` : 'Size not read yet.' }],
      }
    }
    return { usableAs: 'frame', checks: [{ id: 'source', label: 'Use', state: 'pass', detail: 'A still for the video tool to animate.' }] }
  }
  const spec = PRESET_SPECS[preset].output
  if (a.mime === 'video/webm') {
    return { usableAs: 'footage', checks: [{ id: 'container', label: 'Container', state: 'pass', detail: 'WebM source footage: the video tool transcodes it. Not uploadable to a store as is.' }] }
  }
  if (preset === 'app_store_preview') {
    const type = a.width && a.height ? nearestApplePreviewType(a.width, a.height) : 'IPHONE_67'
    return { usableAs: type ? `preview:${type}` : null, checks: checkApplePreview(type ?? 'IPHONE_67', f) }
  }
  const secs = f.durationMs != null ? f.durationMs / 1000 : null
  return {
    usableAs: 'video',
    checks: [
      secs == null
        ? { id: 'duration', label: 'Length', state: 'unknown', detail: `${spec.minSeconds}–${spec.maxSeconds} s.` }
        : { id: 'duration', label: 'Length', state: secs >= spec.minSeconds && secs <= spec.maxSeconds ? 'declared' : 'fail', detail: `${secs.toFixed(1)} s (${spec.minSeconds}–${spec.maxSeconds} s).` },
      f.fps == null
        ? { id: 'fps', label: 'Frame rate', state: 'unknown', detail: `At most ${spec.maxFps} fps.` }
        : { id: 'fps', label: 'Frame rate', state: f.fps <= spec.maxFps ? 'declared' : 'fail', detail: `${f.fps} fps` },
      f.width == null
        ? { id: 'size', label: 'Size', state: 'unknown', detail: `${spec.width}×${spec.height}` }
        : { id: 'size', label: 'Size', state: f.width * spec.height === f.height! * spec.width ? 'declared' : 'fail', detail: `${f.width}×${f.height} (needs ${spec.width}:${spec.height})` },
    ],
  }
}

/** A phone-shaped (portrait) picture: what lazycow's App Store presets show full screen. */
const isPortrait = (a: Pick<KitAssetRow, 'width' | 'height' | 'viewport'>) =>
  a.width && a.height ? a.height > a.width : a.viewport === 'mobile'

/**
 * What a kit still needs for a preset, in lazycow's terms (it renders App
 * Store previews from full-screen "after" screens alone; recordings are
 * optional).
 *
 *   problems     block the export: nothing to show, or (App Store preset) no
 *                phone-shaped "after" screen and no recording
 *   recommended  make the video better but are optional: a recording, and a
 *                "before" for the social and Play cuts
 */
export function kitReadiness(assets: readonly KitAssetRow[], preset: KitPreset): { ready: boolean; screenshots: number; videos: number; problems: string[]; recommended: string[] } {
  const live = assets.filter((a) => a.status === 'ready')
  const afters = live.filter((a) => a.kind === 'screenshot_after' && a.mime.startsWith('image/'))
  const befores = live.filter((a) => a.kind === 'screenshot_before' && a.mime.startsWith('image/'))
  const footage = live.filter((a) => (a.kind === 'clip' || a.kind === 'device_recording') && isVideo(a))
  const screenshots = afters.length + befores.length
  const videos = live.filter((a) => isVideo(a)).length
  const problems: string[] = []
  const recommended: string[] = []
  if (afters.length === 0 && footage.length === 0) {
    problems.push('Add an "after" screenshot or a recording: the video needs something to show.')
  } else if (preset === 'app_store_preview' && !afters.some(isPortrait) && footage.length === 0) {
    problems.push('An App Store preview shows the app full screen on a phone: add a phone-shaped (portrait) "after" screen, or a recording.')
  }
  if (footage.length === 0) {
    recommended.push(preset === 'app_store_preview'
      ? 'Recommended: a short recording of the app in use makes a livelier preview (optional; screens alone work).'
      : 'Recommended: a short recording of the app in use (optional).')
  }
  if (preset !== 'app_store_preview' && afters.length > 0 && befores.length === 0) {
    recommended.push('Recommended: "before" screens let the video show what changed (App Store previews never show them).')
  }
  return { ready: problems.length === 0, screenshots, videos, problems, recommended }
}

/**
 * The changelog lines a video tells: the release's Markdown bullets (or its
 * first sentences), links and emphasis stripped, at most 12 lines of 140
 * characters. Plain text only: it lands on a frame.
 */
export function changelogLines(bodyMd: string | null | undefined): string[] {
  if (!bodyMd) return []
  const clean = (s: string) => s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]+/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const bullets = bodyMd.split(/\r?\n/).map((l) => /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(l)?.[1]).filter((x): x is string => !!x).map(clean).filter(Boolean)
  const lines = bullets.length
    ? bullets
    : clean(bodyMd.replace(/^#.*$/gm, '')).split(/(?<=[.!?])\s+/).filter(Boolean)
  return lines.slice(0, 12).map((l) => (l.length > 140 ? `${l.slice(0, 139).trimEnd()}…` : l))
}

export interface KitBrand {
  name: string
  accent: string | null
  theme: 'light' | 'dark' | 'auto' | null
  logoUrl: string | null
}

const HEX = /^#[0-9a-f]{6}$/i

/** Brand tokens from the project and its widget settings; the kit may override each. */
export function brandFrom(project: { name: string | null }, settings: { sdk_widget_accent?: string | null; sdk_widget_theme?: string | null } | null, override: Partial<KitBrand> = {}): KitBrand {
  const theme = override.theme ?? settings?.sdk_widget_theme ?? null
  const accent = override.accent ?? settings?.sdk_widget_accent ?? null
  return {
    name: (override.name ?? project.name ?? 'My app').slice(0, 80),
    accent: accent && HEX.test(accent) ? accent.toLowerCase() : null,
    theme: theme === 'light' || theme === 'dark' || theme === 'auto' ? theme : null,
    logoUrl: typeof override.logoUrl === 'string' && /^https:\/\//.test(override.logoUrl) ? override.logoUrl.slice(0, 500) : null,
  }
}

/** Mushi's preset → lazycow's `make_product_video` preset (lazycow docs/product-kit.md). */
export const LAZYCOW_PRESET: Record<KitPreset, 'appstore-iphone' | 'play-promo' | 'social-9x16' | 'social-1x1'> = {
  app_store_preview: 'appstore-iphone',
  play_promo: 'play-promo',
  social_vertical: 'social-9x16',
  social_square: 'social-1x1',
}

/** lazycow caps (product-kit.schema.json). */
const LC = { screens: 24, recordings: 8, changelog: 30, line: 140, appName: 60, surface: 40, version: 24, title: 80 }

/** Viewport sizes when an asset carries no measured size. */
const DEFAULT_VIEWPORT: Record<string, { width: number; height: number }> = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
}

function viewportOf(a: Pick<KitAssetRow, 'width' | 'height' | 'viewport' | 'platform'>): ReleaseKitViewport {
  let size = a.width && a.height ? { width: a.width, height: a.height } : null
  if (!size && a.viewport) {
    const m = /^(\d{2,4})x(\d{2,4})$/.exec(a.viewport)
    size = m ? { width: Number(m[1]), height: Number(m[2]) } : DEFAULT_VIEWPORT[a.viewport] ?? null
  }
  size ??= DEFAULT_VIEWPORT.mobile
  // lazycow takes 100–8000 per side; a 2x capture is reported at its CSS size when over.
  const scale = Math.max(1, Math.ceil(Math.max(size.width, size.height) / 8000))
  const width = Math.max(100, Math.round(size.width / scale))
  const height = Math.max(100, Math.round(size.height / scale))
  const device: ReleaseKitViewport['device'] = height > width ? 'phone' : width >= 960 ? 'desktop' : 'tablet'
  return { width, height, device, ...(a.platform ? { platform: a.platform } : {}) }
}

const assetOf = (a: KitAssetRow, url: string): ReleaseKitAsset => ({
  url,
  type: a.mime,
  ...(a.bytes ? { bytes: a.bytes } : {}),
  ...(a.sha256 ? { sha256: a.sha256 } : {}),
})

/** `^[a-z0-9][a-z0-9-]{0,39}$`, unique within the kit. */
function uniqueId(base: string, used: Set<string>): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 34) || 'screen'
  let id = /^[a-z0-9]/.test(slug) ? slug : `s-${slug}`.slice(0, 34)
  for (let n = 2; used.has(id); n++) id = `${slug.slice(0, 34)}-${n}`
  used.add(id)
  return id
}

/** A surface path as a short screen name: `/` → Home, `/settings/billing` → Settings billing. */
export function surfaceName(path: string | null, label: string | null): string | undefined {
  if (label && !/ (before|after)$/.test(label)) return label.slice(0, LC.surface)
  if (!path) return undefined
  const words = path.split(/[/?#]/).filter((p) => p && !/^[0-9a-f-]{8,}$/i.test(p) && !/^\d+$/.test(p)).join(' ').replace(/[-_]+/g, ' ').trim()
  const name = words ? words[0].toUpperCase() + words.slice(1) : 'Home'
  return name.slice(0, LC.surface)
}

export interface ManifestAssetCheck {
  id: string
  kind: KitAssetKind
  url: string
  usableAs: string | null
  checks: SpecCheck[]
}

/**
 * Mushi's own fields on the manifest. lazycow ignores unknown fields, so the
 * kit carries its preset spec, per-asset store checks, the Security proof and
 * the hand-off here without bending the shared contract.
 */
export interface MushiKitExtension {
  kitId: string
  generatedAt: string
  project: { id: string; name: string }
  release: { id: string; version: string; title: string; status: string; publishedAt: string | null; commitSha: string | null }
  preset: PresetSpec
  assets: ManifestAssetCheck[]
  securityProof: { state: string; headline: string } | null
  handoff: {
    tool: 'make_product_video'
    args: { kitUrl: string; preset: (typeof LAZYCOW_PRESET)[KitPreset] }
    /** Where the rendered file comes back: POST it as kind product_video (source lazycow). */
    returnTo: string
  }
}

export type ReleaseKitManifest = ReleaseKit & { mushi: MushiKitExtension }

export class EmptyKitError extends Error {
  constructor() {
    super('The kit has no ready screenshot or recording yet. Copy the baselines or upload a recording first.')
    this.name = 'EmptyKitError'
  }
}

/**
 * Build the `lazycow.release-kit` v1 manifest (lazycow-studio
 * docs/product-kit.schema.json) from ready assets and their absolute signed
 * URLs (asset id → url). Every asset carries its own signed URL, size and
 * SHA-256: a relative URL would not inherit the manifest link's signature.
 * Throws EmptyKitError when there is nothing to show (lazycow needs a screen
 * or a recording).
 */
export function buildManifest(input: {
  kitId: string
  now: Date
  ttlSec: number
  project: { id: string; name: string }
  release: MushiKitExtension['release']
  preset: KitPreset
  brand: KitBrand
  changelog: string[]
  assets: readonly KitAssetRow[]
  urls: ReadonlyMap<string, string>
  securityProof: { state: string; headline: string } | null
  stores?: Array<'app-store' | 'google-play' | 'web'>
  kitUrl: string
  returnTo: string
}): ReleaseKitManifest {
  const ready = input.assets.filter((a) => a.status === 'ready' && input.urls.has(a.id) && /^https:\/\//.test(input.urls.get(a.id)!))
  const url = (a: KitAssetRow) => input.urls.get(a.id)!
  const used = new Set<string>()
  const key = (a: KitAssetRow) => `${a.surface_path ?? a.label ?? a.id}|${a.viewport ?? ''}`

  // Screens: one per surface + viewport with an "after" picture; its "before" when there is one.
  const afters = ready.filter((a) => a.kind === 'screenshot_after' && a.mime.startsWith('image/'))
  const screens: ReleaseKitScreen[] = afters.slice(0, LC.screens).map((after) => {
    const before = ready.find((b) => b.kind === 'screenshot_before' && b.mime.startsWith('image/') && key(b) === key(after))
    const surface = surfaceName(after.surface_path, after.label)
    return {
      id: uniqueId(`${surface ?? 'screen'}-${after.viewport ?? ''}`, used),
      ...(surface ? { surface } : {}),
      viewport: viewportOf(after),
      ...(before ? { before: assetOf(before, url(before)) } : {}),
      after: assetOf(after, url(after)),
    }
  })

  // Recordings: Playwright clips and device recordings (never the rendered video itself).
  const recordings: ReleaseKitRecording[] = ready
    .filter((a) => (a.kind === 'clip' || a.kind === 'device_recording') && a.mime.startsWith('video/'))
    .slice(0, LC.recordings)
    .map((a) => {
      const surface = surfaceName(a.surface_path, a.label)
      return {
        id: uniqueId(`rec-${surface ?? a.kind}`, used),
        ...(surface ? { surface } : {}),
        viewport: viewportOf(a),
        file: assetOf(a, url(a)),
        ...(a.label ? { caption: a.label.slice(0, 120) } : {}),
      }
    })
  if (screens.length === 0 && recordings.length === 0) throw new EmptyKitError()

  const dark = input.brand.theme === 'dark'
  const accent = input.brand.accent as ReleaseKitColor | null
  const colors = {
    ...(accent ? { primary: accent, accent } : {}),
    ...(input.brand.theme === 'dark' || input.brand.theme === 'light'
      ? { background: (dark ? '#0f1115' : '#ffffff') as ReleaseKitColor, text: (dark ? '#f4f5f7' : '#111318') as ReleaseKitColor }
      : {}),
  }
  const lazyPreset = LAZYCOW_PRESET[input.preset]
  const expiresAt = new Date(input.now.getTime() + input.ttlSec * 1000).toISOString()
  const checks: ManifestAssetCheck[] = ready.map((a) => ({ id: a.id, kind: a.kind, url: url(a), ...checkAsset(a, input.preset) }))
  return {
    schema: 'lazycow.release-kit',
    version: 1,
    app: { name: input.project.name.slice(0, LC.appName) || 'My app', ...(input.stores?.length ? { stores: [...new Set(input.stores)] } : {}) },
    release: {
      version: input.release.version.slice(0, LC.version),
      ...(input.release.publishedAt ? { date: input.release.publishedAt.slice(0, 10) } : {}),
      title: input.release.title.slice(0, LC.title),
    },
    brand: {
      ...(Object.keys(colors).length ? { colors } : {}),
      ...(input.brand.logoUrl ? { logo: { url: input.brand.logoUrl } } : {}),
    },
    ...(screens.length ? { screens } : {}),
    ...(recordings.length ? { recordings } : {}),
    changelog: input.changelog.slice(0, LC.changelog).map((l) => l.slice(0, LC.line)),
    expiresAt,
    source: { name: 'Mushi Mushi' },
    mushi: {
      kitId: input.kitId,
      generatedAt: input.now.toISOString(),
      project: input.project,
      release: input.release,
      preset: PRESET_SPECS[input.preset],
      assets: checks,
      securityProof: input.securityProof,
      handoff: { tool: 'make_product_video', args: { kitUrl: input.kitUrl, preset: lazyPreset }, returnTo: input.returnTo },
    },
  }
}

// ── store upload requests (P6) ───────────────────────────────────────────────

export const STORE_UPLOAD_ACTIONS = {
  app_store_connect: ['upload_screenshots', 'upload_app_preview'],
  play_console: ['upload_listing_images', 'set_promo_video'],
} as const

export interface StoreUploadInput {
  kind: 'app_store_connect' | 'play_console'
  action: string
  /** Apple app id (App Store) or package name (Play), from the connector binding. */
  externalId: string
  locale: string
  displayType?: string
  previewType?: string
  imageType?: string
  replace?: boolean
  youtubeUrl?: string
  previewFrameTimeCode?: string
  assetIds: string[]
  /** The release the kit belongs to: lets the team's action list link to where the upload runs. */
  releaseId?: string
}

/**
 * The exact payload a person approves for one store upload: the target and
 * every asset's bucket path, SHA-256, size and type, so act() can prove it
 * sends the bytes that were approved (ADR 0074). Refuses assets that are not
 * ready, have no hash, or fail a spec check for the target.
 */
const rel = (input: Pick<StoreUploadInput, 'releaseId'>) => (input.releaseId ? { releaseId: input.releaseId } : {})

export function storeUploadPayload(kitId: string, assets: readonly KitAssetRow[], input: StoreUploadInput): { ok: true; payload: Record<string, unknown> } | { ok: false; message: string } {
  const allowed = STORE_UPLOAD_ACTIONS[input.kind] as readonly string[]
  if (!allowed.includes(input.action)) return { ok: false, message: `${input.kind} has no "${input.action}" upload.` }
  if (input.action === 'set_promo_video') {
    if (!input.youtubeUrl) return { ok: false, message: 'set_promo_video needs the YouTube URL of the published video.' }
    return { ok: true, payload: { kitId, ...rel(input), package: input.externalId, language: input.locale, youtubeUrl: input.youtubeUrl } }
  }
  const picked = input.assetIds.map((id) => assets.find((a) => a.id === id))
  if (picked.length === 0) return { ok: false, message: 'Pick at least one asset.' }
  if (picked.some((a) => !a)) return { ok: false, message: 'An asset is not in this kit.' }
  const out: Array<Record<string, unknown>> = []
  for (const a of picked as KitAssetRow[]) {
    if (a.status !== 'ready' || !a.sha256 || !a.bytes) return { ok: false, message: `${a.label ?? a.storage_path} is not ready (finish its upload first).` }
    const f = factsOf(a)
    const checks = input.action === 'upload_screenshots'
      ? checkAppleScreenshot(input.displayType ?? '', f)
      : input.action === 'upload_app_preview'
        ? checkApplePreview(input.previewType ?? '', f)
        : checkPlayImage((input.imageType ?? 'phoneScreenshots') as Parameters<typeof checkPlayImage>[0], f)
    const failed = checks.find((c) => c.state === 'fail')
    if (failed) return { ok: false, message: `${a.label ?? 'An asset'}: ${failed.label}: ${failed.detail}` }
    out.push({
      path: a.storage_path, sha256: a.sha256, bytes: a.bytes, mime: a.mime,
      fileName: a.storage_path.split('/').pop()!,
      ...(input.action === 'upload_app_preview' && input.previewFrameTimeCode ? { previewFrameTimeCode: input.previewFrameTimeCode } : {}),
    })
  }
  if (input.kind === 'app_store_connect') {
    return {
      ok: true,
      payload: {
        kitId, ...rel(input), appleId: input.externalId, locale: input.locale,
        ...(input.action === 'upload_screenshots' ? { displayType: input.displayType } : { previewType: input.previewType }),
        assets: out,
      },
    }
  }
  return { ok: true, payload: { kitId, ...rel(input), package: input.externalId, language: input.locale, imageType: input.imageType, replace: input.replace === true, assets: out } }
}

const SAFE_NAME = /[^a-z0-9._-]+/gi

/** `<project>/<kit>/<kind>-<n>-<name>` in the release-kits bucket. */
export function kitAssetPath(projectId: string, kitId: string, kind: KitAssetKind, name: string, n: number): string {
  const ext = /\.(png|jpe?g|webp|mp4|mov|m4v|webm)$/i.exec(name)?.[0]?.toLowerCase() ?? ''
  const base = name.replace(/\.[^.]+$/, '').replace(SAFE_NAME, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'asset'
  return `${projectId}/${kitId}/${kind}-${n}-${base}${ext}`
}

export const MIME_OF_EXT: Record<string, KitMime> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
}
