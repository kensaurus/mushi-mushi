// SPDX-License-Identifier: MIT
/**
 * Release-kit clips (Plan 025 P5, ADR 0074): short Playwright `recordVideo`
 * recordings of an app's top flows, uploaded into one release's kit so a
 * product-video tool (lazycow `make_product_video`) has real footage.
 *
 * Opt-in and capped: the app turns clips on in its release kit (the server
 * answers 403 CLIPS_OFF otherwise), at most 5 flows of 6 screens, each clip
 * stops before maxSeconds (hard cap 60 s) and is dropped above maxBytes
 * (hard cap 100 MB). Every recording context goes through the write guard,
 * like every other capture.
 *
 * The clips are WebM: source footage the video tool transcodes, never an App
 * Store preview on their own. Mushi does not transcode.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext } from 'playwright'
import { gotoPatiently, settle, surfaceUrl } from './capture.js'
import { installGuard, type AllowRule, type GuardLog } from './guard.js'
import type { SyncConfig } from './sync.js'

export const CLIP_LIMITS = {
  maxFlows: 5,
  maxPathsPerFlow: 6,
  defaultSeconds: 30,
  maxSeconds: 60,
  minSeconds: 5,
  defaultBytes: 25 * 1024 * 1024,
  maxBytes: 100 * 1024 * 1024,
  /** How long each screen stays on camera after it settles. */
  dwellMs: 1500,
} as const

export const DEFAULT_CLIP_VIEWPORT = { width: 390, height: 844 } as const

export interface ClipFlow {
  name: string
  paths: string[]
}

export interface ClipResult {
  name: string
  file: string
  bytes: number
  durationMs: number
  width: number
  height: number
  /** The paths the clip actually shows (a flow is cut short when it runs out of time). */
  paths: string[]
}

export interface ClipSkip {
  name: string
  reason: string
}

const SLUG_RE = /[^a-z0-9]+/g

/** Pure: a file-safe name for a flow ("Sign up!" → "sign-up"). */
export function clipSlug(name: string): string {
  return name.toLowerCase().replace(SLUG_RE, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'flow'
}

/**
 * Pure: one `--flow` value, `name:/a,/b` (or just `/a,/b`, named after its
 * first path). Paths must start with `/`. Throws with a plain reason.
 */
export function parseFlow(value: string): ClipFlow {
  const raw = value.trim()
  const colon = raw.indexOf(':')
  const hasName = colon > 0 && !raw.slice(0, colon).includes('/')
  const name = hasName ? raw.slice(0, colon).trim() : ''
  const paths = (hasName ? raw.slice(colon + 1) : raw).split(',').map((p) => p.trim()).filter(Boolean)
  if (!paths.length) throw new Error(`--flow "${value}" names no paths; use name:/a,/b`)
  for (const p of paths) if (!p.startsWith('/') || p.startsWith('//')) throw new Error(`--flow path "${p}" must start with a single /`)
  return { name: (name || paths[0]!).slice(0, 80), paths }
}

/** Pure: cap the flows (count, paths each, unique names) and say what was cut. */
export function capFlows(flows: readonly ClipFlow[]): { flows: ClipFlow[]; notes: string[] } {
  const notes: string[] = []
  if (flows.length > CLIP_LIMITS.maxFlows) notes.push(`Only the first ${CLIP_LIMITS.maxFlows} of ${flows.length} flows are recorded.`)
  const seen = new Set<string>()
  const out: ClipFlow[] = []
  for (const f of flows.slice(0, CLIP_LIMITS.maxFlows)) {
    let slug = clipSlug(f.name)
    for (let i = 2; seen.has(slug); i++) slug = `${clipSlug(f.name)}-${i}`
    seen.add(slug)
    if (f.paths.length > CLIP_LIMITS.maxPathsPerFlow) notes.push(`"${f.name}": only the first ${CLIP_LIMITS.maxPathsPerFlow} of ${f.paths.length} screens.`)
    out.push({ name: f.name, paths: f.paths.slice(0, CLIP_LIMITS.maxPathsPerFlow) })
  }
  return { flows: out, notes }
}

/** Pure: the caps clamped to their hard limits. */
export function clampCaps(input: { maxSeconds?: number; maxBytes?: number }): { maxSeconds: number; maxBytes: number } {
  const secs = Number.isFinite(input.maxSeconds) ? Number(input.maxSeconds) : CLIP_LIMITS.defaultSeconds
  const bytes = Number.isFinite(input.maxBytes) ? Number(input.maxBytes) : CLIP_LIMITS.defaultBytes
  return {
    maxSeconds: Math.min(CLIP_LIMITS.maxSeconds, Math.max(CLIP_LIMITS.minSeconds, Math.floor(secs))),
    maxBytes: Math.min(CLIP_LIMITS.maxBytes, Math.max(1024 * 1024, Math.floor(bytes))),
  }
}

/**
 * Pure: whether there is time for one more screen. A screen costs its
 * navigation and settle (estimated from the slowest so far, at least 3 s)
 * plus the dwell; the clip stops before it would run past maxSeconds.
 */
export function hasTimeForScreen(elapsedMs: number, slowestScreenMs: number, maxSeconds: number): boolean {
  const next = Math.max(3000, slowestScreenMs) + CLIP_LIMITS.dwellMs
  return elapsedMs + next <= maxSeconds * 1000
}

export interface RecordClipsOptions {
  baseUrl: string
  flows: readonly ClipFlow[]
  outDir: string
  viewport?: { width: number; height: number }
  maxSeconds?: number
  maxBytes?: number
  allow?: readonly AllowRule[]
  /** A cached, signed-in profile: its storage seeds every recording context. */
  profileDir?: string
  channel?: 'chrome' | 'chromium'
  headless?: boolean
  log?: (m: string) => void
}

/** Record one clip per flow. Returns the clips kept and the ones dropped (with why). */
export async function recordClips(opts: RecordClipsOptions): Promise<{ clips: ClipResult[]; skipped: ClipSkip[]; notes: string[]; guard: GuardLog }> {
  const log = opts.log ?? (() => {})
  const { flows, notes } = capFlows(opts.flows)
  const { maxSeconds, maxBytes } = clampCaps({ maxSeconds: opts.maxSeconds, maxBytes: opts.maxBytes })
  const viewport = opts.viewport ?? DEFAULT_CLIP_VIEWPORT
  const headless = opts.headless ?? true
  const channel = opts.channel === 'chrome' ? { channel: 'chrome' as const } : {}
  mkdirSync(opts.outDir, { recursive: true })
  const guard: GuardLog = { blocked: [] }
  const clips: ClipResult[] = []
  const skipped: ClipSkip[] = []

  // A persistent profile cannot spawn recording contexts: read its storage once, then record in a second browser.
  let storageState: Awaited<ReturnType<BrowserContext['storageState']>> | undefined
  if (opts.profileDir) {
    const persistent = await chromium.launchPersistentContext(opts.profileDir, { headless, serviceWorkers: 'block', ...channel })
    try {
      storageState = await persistent.storageState()
    } finally {
      await persistent.close()
    }
  }
  const browser: Browser = await chromium.launch({ headless, ...channel })
  try {
    for (const flow of flows) {
      const slug = clipSlug(flow.name)
      const rawDir = join(opts.outDir, `.raw-${slug}`)
      const context = await browser.newContext({
        serviceWorkers: 'block',
        viewport,
        recordVideo: { dir: rawDir, size: viewport },
        ...(storageState ? { storageState } : {}),
      })
      await installGuard(context, opts.allow ?? [], guard)
      const page = await context.newPage()
      const started = Date.now()
      const shown: string[] = []
      let slowest = 0
      let failure: string | null = null
      try {
        for (const p of flow.paths) {
          if (!hasTimeForScreen(Date.now() - started, slowest, maxSeconds)) {
            notes.push(`"${flow.name}": stopped after ${shown.length} screen(s) to stay under ${maxSeconds} s.`)
            break
          }
          const t0 = Date.now()
          await gotoPatiently(page, surfaceUrl(opts.baseUrl, p))
          await settle(page)
          slowest = Math.max(slowest, Date.now() - t0)
          await page.waitForTimeout(CLIP_LIMITS.dwellMs)
          shown.push(p)
        }
      } catch (err) {
        failure = (err as Error).message.split('\n')[0]!.slice(0, 200)
      }
      const durationMs = Date.now() - started
      const video = page.video()
      // Closing the context writes the video file.
      await context.close()
      const rawPath = await video?.path().catch(() => null)
      const file = join(opts.outDir, `${slug}.webm`)
      if (!rawPath || shown.length === 0) {
        skipped.push({ name: flow.name, reason: failure ?? 'No screen loaded.' })
        rmSync(rawDir, { recursive: true, force: true })
        continue
      }
      renameSync(rawPath, file)
      rmSync(rawDir, { recursive: true, force: true })
      const bytes = statSync(file).size
      if (bytes > maxBytes) {
        rmSync(file, { force: true })
        skipped.push({ name: flow.name, reason: `${(bytes / 1048576).toFixed(1)} MB is over the ${(maxBytes / 1048576).toFixed(0)} MB cap.` })
        continue
      }
      if (failure) notes.push(`"${flow.name}": stopped at an error after ${shown.length} screen(s): ${failure}`)
      clips.push({ name: flow.name, file, bytes, durationMs, width: viewport.width, height: viewport.height, paths: shown })
      log(`Recorded "${flow.name}" (${shown.length} screen(s), ${(durationMs / 1000).toFixed(1)} s, ${(bytes / 1048576).toFixed(1)} MB)`)
    }
  } finally {
    await browser.close()
  }
  return { clips, skipped, notes, guard }
}

// ── upload into a release kit ────────────────────────────────────────────────

/** Pure: the POST …/kit/uploads body for these clips. */
export function clipUploadBody(clips: readonly ClipResult[]) {
  return {
    files: clips.map((c) => ({
      name: `${clipSlug(c.name)}.webm`,
      kind: 'clip' as const,
      mime: 'video/webm' as const,
      bytes: c.bytes,
      source: 'playwright' as const,
      platform: 'web' as const,
      durationMs: Math.max(1, Math.round(c.durationMs)),
      width: c.width,
      height: c.height,
      surfacePath: c.paths[0] ?? null,
      label: c.name.slice(0, 200),
    })),
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

async function call(fetchImpl: FetchLike, cfg: SyncConfig, path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetchImpl(`${cfg.endpoint}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}`, 'X-Mushi-Api-Key': cfg.apiKey, 'X-Mushi-Project': cfg.projectId, ...(init.headers ?? {}) },
  })
  const body = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, body }
}

function apiMessage(r: { status: number; body: unknown }): string {
  const e = (r.body as { error?: { code?: string; message?: string } } | null)?.error
  return e?.message ? e.message.slice(0, 300) : `the API answered ${r.status}`
}

/** The app's clip settings as the kit route serves them (project_settings.release_kit_clip_*). */
export interface ServerClipCaps {
  clipsEnabled: boolean
  maxSeconds: number
  maxBytes: number
}

/**
 * Read the app's clip caps from the release's kit before recording, so a
 * clip is never recorded that the server will refuse. `null` = could not
 * read them (offline, old server, no access): the caller falls back to the
 * local defaults and the server still enforces its caps on upload.
 */
export async function fetchClipCaps(cfg: SyncConfig, releaseId: string, fetchImpl: FetchLike = fetch): Promise<ServerClipCaps | null> {
  try {
    const r = await call(fetchImpl, cfg, `/v1/admin/projects/${encodeURIComponent(cfg.projectId)}/releases/${encodeURIComponent(releaseId)}/kit`)
    if (!r.ok) return null
    const s = (r.body as { data?: { settings?: { clipsEnabled?: unknown; clipMaxSeconds?: unknown; clipMaxMb?: unknown } } } | null)?.data?.settings
    if (!s || typeof s.clipsEnabled !== 'boolean' || typeof s.clipMaxSeconds !== 'number' || typeof s.clipMaxMb !== 'number') return null
    return { clipsEnabled: s.clipsEnabled, maxSeconds: s.clipMaxSeconds, maxBytes: s.clipMaxMb * 1024 * 1024 }
  } catch {
    return null
  }
}

/**
 * Pure: the caps a recording uses. The lower of what was asked and what the
 * app allows, clamped to the hard limits; `blocked` (with the reason) when
 * the app has clips turned off, so nothing is recorded only to be refused.
 */
export function effectiveClipCaps(requested: { maxSeconds?: number; maxBytes?: number }, server: ServerClipCaps | null): { maxSeconds: number; maxBytes: number; notes: string[]; blocked: string | null } {
  const asked = clampCaps(requested)
  if (!server) {
    return { ...asked, blocked: null, notes: ['Could not read this app\'s clip settings; using the local caps (the server still checks them on upload).'] }
  }
  if (!server.clipsEnabled) {
    return { ...asked, notes: [], blocked: 'Recording clips is off for this app. Turn on "Record clips for release kits" in the release\'s kit (Releases → the release → Ship it), then run this again.' }
  }
  const capped = clampCaps({ maxSeconds: Math.min(asked.maxSeconds, server.maxSeconds), maxBytes: Math.min(asked.maxBytes, server.maxBytes) })
  const notes: string[] = []
  if (capped.maxSeconds < asked.maxSeconds) notes.push(`This app caps clips at ${capped.maxSeconds} s; recording up to that.`)
  if (capped.maxBytes < asked.maxBytes) notes.push(`This app caps clips at ${Math.round(capped.maxBytes / 1048576)} MB; larger ones are dropped before upload.`)
  return { ...capped, notes, blocked: null }
}

export interface ClipUploadOutcome {
  uploaded: Array<{ name: string; assetId: string }>
  failed: Array<{ name: string; reason: string }>
}

/**
 * Upload clips into one release's kit: reserve signed URLs, PUT each file,
 * then finalize it with its SHA-256 so the server can prove the bytes. The
 * server's refusal (CLIPS_OFF: turn clips on in the kit) is thrown as is.
 */
export async function uploadClips(cfg: SyncConfig, releaseId: string, clips: readonly ClipResult[], fetchImpl: FetchLike = fetch): Promise<ClipUploadOutcome> {
  const base = `/v1/admin/projects/${encodeURIComponent(cfg.projectId)}/releases/${encodeURIComponent(releaseId)}/kit`
  const out: ClipUploadOutcome = { uploaded: [], failed: [] }
  if (!clips.length) return out
  const r = await call(fetchImpl, cfg, `${base}/uploads`, { method: 'POST', body: JSON.stringify(clipUploadBody(clips)) })
  if (!r.ok) throw new Error(`Clips not uploaded: ${apiMessage(r)}`)
  const uploads = ((r.body as { data?: { uploads?: Array<{ name: string; assetId: string; signedUrl: string }> } } | null)?.data?.uploads ?? [])
  for (let i = 0; i < uploads.length; i++) {
    const u = uploads[i]!
    const clip = clips[i]!
    const bytes = readFileSync(clip.file)
    const put = await fetchImpl(u.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'video/webm' }, body: new Uint8Array(bytes) })
    if (!put.ok) {
      out.failed.push({ name: clip.name, reason: `storage answered ${put.status}` })
      continue
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const fin = await call(fetchImpl, cfg, `${base}/assets/${encodeURIComponent(u.assetId)}/finalize`, { method: 'POST', body: JSON.stringify({ sha256 }) })
    if (!fin.ok) out.failed.push({ name: clip.name, reason: apiMessage(fin) })
    else out.uploaded.push({ name: clip.name, assetId: u.assetId })
  }
  return out
}
