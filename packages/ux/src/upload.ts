// SPDX-License-Identifier: MIT
/**
 * `mushi-ux upload <dir>`: put screenshots any driver made into a UX scorecard
 * run (ADR 0073), so a native app's screens are scored on the same rubric,
 * probes and judge as a web page.
 *
 * Layout (the scorecard's own capture layout, as `--from-captures` reads it):
 *
 *   <dir>/pages/<screen>/settled.png      required (or early.png)
 *   <dir>/pages/<screen>/early.png        optional: the screen about 1 s in
 *   <dir>/pages/<screen>/facts.json       optional: any of the page facts
 *   <dir>/pages/<screen>/window.xml       optional: `adb exec-out uiautomator dump /dev/tty`
 *   <dir>/pages/<screen>/hierarchy.json   optional: `maestro hierarchy`
 *
 * Steps: read and check every screen (a real PNG, at most 8 MB), POST
 * /v1/ux/captures (one run, its scoring budget reserved), PUT each PNG to its
 * signed URL, then with `--score` score each screen on the server, group the
 * causes, close the run, and with `--file` file the top causes as reports.
 * Templates for Maestro, adb and the iOS simulator: docs/templates/ux-native/.
 */

import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { nativeFacts, parseMaestroHierarchy, parseUiautomator, pngSize, type NativeNode } from './native-facts.js'
import { fileScorecard, type ScorecardFileOutcome } from './scorecard.js'
import { scorecardPageKey, type UxCause, type UxPageFacts, type UxPageScore } from './scorecard-rubric.js'
import { consoleBaseUrl, type SyncConfig } from './sync.js'

/** A file's size and first 32 bytes, read through one descriptor so both describe the same file. */
function sizeAndHead(file: string): { size: number; head: Uint8Array } {
  const fd = openSync(file, 'r')
  try {
    const head = Buffer.alloc(32)
    const n = readSync(fd, head, 0, 32, 0)
    return { size: fstatSync(fd).size, head: head.subarray(0, n) }
  } finally {
    closeSync(fd)
  }
}

export const UPLOAD_PLATFORMS = ['ios', 'android', 'flutter', 'react_native', 'capacitor', 'web', 'other'] as const
export type UploadPlatform = (typeof UPLOAD_PLATFORMS)[number]
export const UPLOAD_SOURCES = ['maestro', 'adb', 'simctl', 'sdk', 'playwright', 'other'] as const
export type UploadSource = (typeof UPLOAD_SOURCES)[number]

/** The server's caps (POST /v1/ux/captures). */
export const UPLOAD_MAX_PAGES = 60
export const UPLOAD_MAX_PNG_BYTES = 8 * 1024 * 1024

export interface CapturedScreen {
  folder: string
  facts: UxPageFacts
  shots: Array<'early' | 'settled'>
}

/** Read every screen under `<dir>/pages`; throws with a plain message on a screen that cannot be uploaded. */
export function readScreens(dir: string, opts: { scale?: number } = {}): CapturedScreen[] {
  const root = join(dir, 'pages')
  if (!existsSync(root)) throw new Error(`No ${root} folder. Put each screen in <dir>/pages/<screen>/settled.png (see docs/templates/ux-native/).`)
  const out: CapturedScreen[] = []
  for (const name of readdirSync(root).sort()) {
    const folder = join(root, name)
    if (!statSync(folder).isDirectory()) continue
    const shots = (['early', 'settled'] as const).filter((s) => existsSync(join(folder, `${s}.png`)))
    if (!shots.length) continue
    let settledSize: { width: number; height: number } | null = null
    for (const s of shots) {
      const file = join(folder, `${s}.png`)
      const { size, head } = sizeAndHead(file)
      if (size > UPLOAD_MAX_PNG_BYTES) throw new Error(`${file} is ${(size / 1024 / 1024).toFixed(1)} MB; a screenshot may be at most 8 MB.`)
      const dims = pngSize(head)
      if (!dims) throw new Error(`${file} is not a PNG. (In Windows PowerShell 5.1, \`adb exec-out screencap -p > x.png\` corrupts it: run the template in bash or Git Bash.)`)
      if (s === 'settled' || !settledSize) settledSize = dims
    }
    let given: Partial<UxPageFacts> | null = null
    const factsFile = join(folder, 'facts.json')
    if (existsSync(factsFile)) {
      try {
        given = JSON.parse(readFileSync(factsFile, 'utf8')) as Partial<UxPageFacts>
      } catch {
        throw new Error(`${factsFile} is not valid JSON.`)
      }
    }
    let nodes: NativeNode[] | null = null
    if (existsSync(join(folder, 'window.xml'))) nodes = parseUiautomator(readFileSync(join(folder, 'window.xml'), 'utf8'))
    else if (existsSync(join(folder, 'hierarchy.json'))) nodes = parseMaestroHierarchy(readFileSync(join(folder, 'hierarchy.json'), 'utf8'))
    const facts = nativeFacts({ folder: name, given, nodes, png: settledSize, scale: opts.scale })
    // The page's identity as the server keys it (as readCaptures does), so the upload URLs match.
    out.push({ folder, facts: { ...facts, key: scorecardPageKey(facts.key) }, shots: [...shots] })
  }
  if (!out.length) throw new Error(`No screenshots in ${root}: each screen needs a settled.png (or early.png).`)
  if (out.length > UPLOAD_MAX_PAGES) throw new Error(`${out.length} screens; one upload takes at most ${UPLOAD_MAX_PAGES}. Split the folder.`)
  const keys = new Set<string>()
  for (const s of out) {
    if (keys.has(s.facts.key)) throw new Error(`Two screens have the key "${s.facts.key}". Give each its own name or facts.json key.`)
    keys.add(s.facts.key)
  }
  return out
}

interface ApiResult {
  ok: boolean
  status: number
  body: unknown
}

async function api(cfg: SyncConfig, path: string, init: RequestInit, fetchImpl: typeof fetch): Promise<ApiResult> {
  const res = await fetchImpl(`${cfg.endpoint}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}`, 'X-Mushi-Api-Key': cfg.apiKey, 'X-Mushi-Project-Id': cfg.projectId, ...(init.headers ?? {}) },
  })
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) }
}

function apiError(r: ApiResult): string {
  const e = (r.body as { error?: { message?: string } } | null)?.error?.message
  return `the API answered ${r.status}${e ? `: ${e.slice(0, 300)}` : ''}`
}

export interface UploadOptions {
  dir: string
  platform: UploadPlatform
  device?: string
  source?: UploadSource
  /** What to call the app in prompts and on the run. */
  app?: string
  about?: string
  /** Pixels per point of the device, to record the viewport in points (default 1: pixels). */
  scale?: number
  /** WIDTHxHEIGHT for the run (default: the first screen's). */
  viewport?: string
  /** The most the run may spend on server scoring. */
  maxCostUsd?: number
  /** Score each screen on the server after the upload, group the causes and close the run. */
  score?: boolean
  /** With score: file the top causes as reports. */
  file?: boolean
  /** With file: show what would be filed. */
  dryRun?: boolean
  concurrency?: number
  onProgress?: (msg: string) => void
  fetchImpl?: typeof fetch
}

export interface UploadResult {
  runId: string
  pages: number
  uploaded: number
  reservedUsd: number | null
  scored: number
  mean: number | null
  causes: UxCause[]
  errors: string[]
  filed?: ScorecardFileOutcome
  consoleUrl: string
}

/** Run `fn` over items, at most `n` at a time. */
async function pool<T>(items: readonly T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const worker = async () => {
    while (i < items.length) await fn(items[i++]!)
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker))
}

export async function uploadCaptures(cfg: SyncConfig, opts: UploadOptions): Promise<UploadResult> {
  const progress = opts.onProgress ?? (() => {})
  const doFetch = opts.fetchImpl ?? fetch
  const screens = readScreens(opts.dir, { scale: opts.scale })
  progress(`${screens.length} screen(s) to upload (${opts.platform}${opts.device ? `, ${opts.device}` : ''})`)
  const startedAt = new Date().toISOString()
  const created = await api(
    cfg,
    '/v1/ux/captures',
    {
      method: 'POST',
      body: JSON.stringify({
        platform: opts.platform,
        ...(opts.device ? { device: opts.device } : {}),
        ...(opts.source ? { source: opts.source } : {}),
        ...(opts.app ? { app: opts.app } : {}),
        ...(opts.viewport ? { viewport: opts.viewport } : {}),
        ...(opts.maxCostUsd !== undefined ? { maxCostUsd: opts.maxCostUsd } : {}),
        pages: screens.map((s) => ({ facts: s.facts, shots: s.shots })),
      }),
    },
    doFetch,
  )
  if (!created.ok) throw new Error(`The captures were not accepted: ${apiError(created)}`)
  const d = (created.body as { data?: { runId: string; reservedUsd: number | null; uploads: Array<{ page: string; name: string; signedUrl: string }> } } | null)?.data
  if (!d?.runId) throw new Error('The API returned no run id.')
  const runId = d.runId

  // Each shot to its signed URL.
  const byKey = new Map(screens.map((s) => [s.facts.key, s]))
  const shotNames = new Map<string, string[]>()
  let uploaded = 0
  for (const u of d.uploads ?? []) {
    const screen = byKey.get(u.page)
    if (!screen) continue
    const shot = u.name.endsWith('/early.png') ? 'early' : 'settled'
    const png = readFileSync(join(screen.folder, `${shot}.png`))
    const put = await doFetch(u.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(png) })
    if (!put.ok) throw new Error(`Screenshot ${u.name} not uploaded: storage answered ${put.status}. Retry; the run is ${runId}.`)
    shotNames.set(u.page, [...(shotNames.get(u.page) ?? []), u.name])
    uploaded++
  }
  progress(`uploaded ${uploaded} screenshot(s) to run ${runId}`)
  const consoleUrl = `${consoleBaseUrl()}/ux-runs?view=scorecard&run=${runId}`
  const result: UploadResult = { runId, pages: screens.length, uploaded, reservedUsd: d.reservedUsd ?? null, scored: 0, mean: null, causes: [], errors: [], consoleUrl }
  if (!opts.score) return result

  // Score on the server: one model call a screen, on the run's reservation.
  const scores = new Map<string, UxPageScore>()
  const labels = screens.map((s) => s.facts.label)
  await pool(screens, opts.concurrency ?? 3, async (s) => {
    const ask = () =>
      api(
        cfg,
        `/v1/admin/projects/${cfg.projectId}/ux-scorecard/${runId}/score`,
        { method: 'POST', body: JSON.stringify({ facts: s.facts, shots: shotNames.get(s.facts.key) ?? [], app: opts.app ?? 'this app', about: opts.about, other_pages: labels.filter((l) => l !== s.facts.label) }) },
        doFetch,
      )
    let r = await ask()
    // One retry, except when the run's budget is spent (a retry cannot help).
    if (!r.ok && r.status !== 402) r = await ask()
    const score = (r.body as { data?: { score?: UxPageScore } } | null)?.data?.score
    if (r.ok && score) {
      scores.set(s.facts.key, score)
      progress(`scored ${s.facts.key}: ${score.overall}/10`)
    } else {
      result.errors.push(`${s.facts.key}: ${apiError(r)}`)
      progress(`could not score ${s.facts.key}: ${apiError(r)}`)
    }
  })
  result.scored = scores.size
  result.mean = scores.size ? Math.round(([...scores.values()].reduce((n, x) => n + x.overall, 0) / scores.size) * 10) / 10 : null
  const grouped = await api(cfg, `/v1/admin/projects/${cfg.projectId}/ux-scorecard/${runId}/group`, { method: 'POST', body: '{}' }, doFetch)
  if (grouped.ok) result.causes = ((grouped.body as { data?: { causes?: UxCause[] } } | null)?.data?.causes ?? []) as UxCause[]
  else result.errors.push(`grouping: ${apiError(grouped)}`)

  // Close the run (no start_url: a native run keeps the line the upload wrote); this releases its unused budget.
  const vp = opts.viewport ?? `${screens[0]!.facts.viewport.width}x${screens[0]!.facts.viewport.height}`
  const closed = await api(
    cfg,
    `/v1/admin/projects/${cfg.projectId}/ux-scorecard/${runId}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        status: 'done',
        viewport: vp,
        scored_by: 'server',
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        error: null,
        pages: screens.map((s) => ({ facts: s.facts, score: scores.get(s.facts.key) ?? null, shots: shotNames.get(s.facts.key) ?? [], ...(scores.has(s.facts.key) ? {} : { error: 'Not scored.' }) })),
        causes: result.causes,
      }),
    },
    doFetch,
  )
  if (!closed.ok) result.errors.push(`closing the run: ${apiError(closed)}`)
  if (opts.file) result.filed = await fileScorecard(cfg, runId, { causes: result.causes, dryRun: opts.dryRun })
  return result
}
