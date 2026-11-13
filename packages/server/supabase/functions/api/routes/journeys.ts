/**
 * FILE: packages/server/supabase/functions/api/routes/journeys.ts
 * PURPOSE: The Journey optimizer (ADR 0058): how people move through the
 *          app, and what in the site map gets in their way.
 *
 *   GET  /v1/admin/projects/:id/journeys?days=7|30|90
 *        The map: page-to-page moves from real visits (session_page_views),
 *        the latest site scan's links, and findings with a suggestion and
 *        an agent prompt each (_shared/journey-map.ts). Any member; console
 *        JWT or a project key with mcp:read (MCP get_journeys).
 *   POST /v1/admin/projects/:id/journeys/scan  { base_url?: string }
 *        Start a site scan: Firecrawl maps the live site and reads up to 40
 *        pages (no LLM), keeping each page's title, internal links and a
 *        content fingerprint in site_structure_scans. Not for viewers. One
 *        scan at a time per app, at most one every 10 minutes. mcp:write
 *        keys too (MCP scan_site_journeys).
 *   PUT  /v1/admin/projects/:id/journeys/recording  { hours: 0–168, sample_rate?: (0,1] }
 *        Open (or stop, hours 0) the on-demand visit recording window that
 *        SDKs in `trackSessions: 'on-demand'` mode read from /v1/sdk/config.
 *
 * Served by api-ext (deploy size limit); `api` forwards both paths.
 */

import type { Context, Hono } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { log } from '../../_shared/logger.ts'
import { logAudit } from '../../_shared/audit.ts'
import { runInBackground } from '../../_shared/background.ts'
import { firecrawlMapOwnSite, firecrawlScrapeOwnSite } from '../../_shared/firecrawl.ts'
import { assertSafeOutboundUrl } from '../../_shared/inventory-guards.ts'
import { pickCrawlUrls } from '../../_shared/crawl-urls.ts'
import { readAllPages } from '../../_shared/paged-read.ts'
import { normalizeRoute } from '../../_shared/project-home.ts'
import {
  boilerplateLines,
  buildJourneyMap,
  internalPaths,
  minhash,
  ownWords,
  type JourneyMap,
  type PageViewRow,
  type ScannedPage,
} from '../../_shared/journey-map.ts'
import { callerCanAccessProject, dbError, parseUuidParam } from '../shared.ts'

type Ctx = Context<{ Variables: Variables }>
type Db = ReturnType<typeof getServiceClient>

/** Most visit rows one map reads (newest first), in pages of the server's 1,000-row cap. */
export const VIEW_SAMPLE = 10_000
export const SCAN_MAX_PAGES = 40
const SCAN_CONCURRENCY = 4
/** A running scan older than this is treated as dead (the isolate was recycled). */
const SCAN_STALE_MS = 10 * 60_000
const SCAN_COOLDOWN_MS = 10 * 60_000
const KEEP_SCANS = 10
const DAY_OPTIONS = [7, 30, 90] as const

export interface ScanSummary {
  id: string
  status: 'running' | 'done' | 'failed'
  baseUrl: string
  pageCount: number
  error: string | null
  createdAt: string
  finishedAt: string | null
}

export interface JourneysResponse {
  days: number
  liveUrl: string | null
  /** The newest scan, running or not. */
  scan: ScanSummary | null
  /** The scan the map was built from (the newest finished one). */
  mapScan: ScanSummary | null
  /** On-demand visit recording (SDK `trackSessions: 'on-demand'`); `until` null = off. */
  recording: { until: string | null; sampleRate: number }
  map: JourneyMap
}

interface ScanRow {
  id: string
  status: 'running' | 'done' | 'failed'
  base_url: string
  page_count: number
  error: string | null
  created_at: string
  finished_at: string | null
  pages?: ScannedPage[]
}

const scanBody = z.object({ base_url: z.string().url().max(500).optional() }).strict()

/** Longest recording window: one week. */
export const RECORDING_MAX_HOURS = 168
const recordingBody = z
  .object({
    /** 0 stops recording. */
    hours: z.number().int().min(0).max(RECORDING_MAX_HOURS),
    sample_rate: z.number().gt(0).max(1).optional(),
  })
  .strict()

export function registerJourneyRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/projects/:id/journeys', adminOrApiKey({ scope: 'mcp:read' }), async (c: Ctx) => {
    const db = getServiceClient()
    const access = await projectAccess(c, db)
    if ('response' in access) return access.response
    const days = DAY_OPTIONS.find((d) => String(d) === c.req.query('days')) ?? 30
    try {
      return c.json({ ok: true, data: await readJourneys(db, access.projectId, days) })
    } catch (err) {
      return dbError(c, err as { message: string })
    }
  })

  app.post('/v1/admin/projects/:id/journeys/scan', adminOrApiKey({ scope: 'mcp:write' }), async (c: Ctx) => {
    const db = getServiceClient()
    const access = await projectAccess(c, db)
    if ('response' in access) return access.response
    if (access.role === 'viewer') {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Viewers cannot start a site scan. Ask an admin of this app.' } }, 403)
    }
    let raw: unknown = {}
    try {
      const text = await c.req.text()
      raw = text ? JSON.parse(text) : {}
    } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON', message: 'Send a JSON body, or none.' } }, 400)
    }
    const body = scanBody.safeParse(raw)
    if (!body.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: body.error.issues[0]?.message ?? 'Invalid body' } }, 400)
    }
    const projectId = access.projectId

    const baseUrl = body.data.base_url ?? (await liveUrlFor(db, projectId))
    if (!baseUrl) {
      return c.json(
        { ok: false, error: { code: 'NO_LIVE_URL', message: "Mushi Mushi doesn't know your site's address yet. Type it in and scan again." } },
        400,
      )
    }
    const safe = assertSafeOutboundUrl(baseUrl)
    if (!safe.ok) {
      return c.json({ ok: false, error: { code: 'UNSAFE_URL', message: `This address can't be scanned (${safe.reason}). Use your public https:// address.` } }, 400)
    }

    const { data: latest, error: latestErr } = await db
      .from('site_structure_scans')
      .select('id, status, created_at, finished_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latestErr) return dbError(c, latestErr)
    const now = Date.now()
    if (latest) {
      const started = Date.parse(latest.created_at as string)
      if (latest.status === 'running' && now - started < SCAN_STALE_MS) {
        return c.json({ ok: false, error: { code: 'SCAN_RUNNING', message: 'A scan of this app is already running. It usually takes under a minute.' } }, 409)
      }
      const last = Date.parse((latest.finished_at as string | null) ?? (latest.created_at as string))
      if (latest.status === 'done' && now - last < SCAN_COOLDOWN_MS) {
        const wait = Math.ceil((SCAN_COOLDOWN_MS - (now - last)) / 60_000)
        c.header('Retry-After', String(wait * 60))
        return c.json({ ok: false, error: { code: 'SCAN_TOO_SOON', message: `This app was scanned a moment ago. Scan again in ${wait} min.` } }, 429)
      }
    }

    const { data: row, error } = await db
      .from('site_structure_scans')
      .insert({ project_id: projectId, base_url: baseUrl, status: 'running', page_count: 0, error: null, requested_by: c.get('userId') as string })
      .select('id, status, base_url, page_count, error, created_at, finished_at')
      .single()
    if (error || !row) return dbError(c, error ?? { message: 'insert returned no row' })

    runInBackground(runScan(db, projectId, row.id as string, baseUrl), 'journeys.scan')
    void logAudit(db, projectId, c.get('userId') as string, 'settings.updated', 'site_structure_scan', row.id as string, { base_url: baseUrl }).catch(() => {})
    return c.json({ ok: true, data: { scan: toSummary(row as ScanRow) } }, 202)
  })

  // Open, extend or stop the on-demand recording window. Apps whose SDK runs
  // `trackSessions: 'on-demand'` record that share of visitors until it ends.
  app.put('/v1/admin/projects/:id/journeys/recording', adminOrApiKey({ scope: 'mcp:write' }), async (c: Ctx) => {
    const db = getServiceClient()
    const access = await projectAccess(c, db)
    if ('response' in access) return access.response
    if (access.role === 'viewer') {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Viewers cannot record visits. Ask an admin of this app.' } }, 403)
    }
    const body = recordingBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success) {
      return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message: body.error.issues[0]?.message ?? 'Send { hours, sample_rate? }.' } }, 400)
    }
    const until = body.data.hours === 0 ? null : new Date(Date.now() + body.data.hours * 3_600_000).toISOString()
    const patch: Record<string, unknown> = { journey_recording_until: until }
    if (body.data.sample_rate !== undefined) patch.journey_recording_sample = body.data.sample_rate
    const { data, error } = await db
      .from('project_settings')
      .upsert({ project_id: access.projectId, ...patch }, { onConflict: 'project_id' })
      .select('journey_recording_until, journey_recording_sample')
      .single()
    if (error) return dbError(c, error)
    void logAudit(db, access.projectId, c.get('userId') as string, 'settings.updated', 'journey_recording', access.projectId, { hours: body.data.hours, sample_rate: body.data.sample_rate ?? null }).catch(() => {})
    return c.json({ ok: true, data: { recording: recordingOf(data as RecordingRow | null, new Date()) } })
  })
}

interface RecordingRow {
  journey_recording_until: string | null
  journey_recording_sample: number | null
}

export function recordingOf(row: RecordingRow | null, now: Date): { until: string | null; sampleRate: number } {
  const until = row?.journey_recording_until && Date.parse(row.journey_recording_until) > now.getTime() ? row.journey_recording_until : null
  const rate = Number(row?.journey_recording_sample)
  return { until, sampleRate: Number.isFinite(rate) && rate > 0 ? Math.min(1, rate) : 0.1 }
}

async function projectAccess(c: Ctx, db: Db): Promise<{ projectId: string; role: string } | { response: Response }> {
  const parsed = parseUuidParam(c)
  if (!parsed.ok) return { response: parsed.error }
  const access = await callerCanAccessProject(c, db, c.get('userId') as string, parsed.value)
  if (!access.allowed) return { response: c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found.' } }, 404) }
  return { projectId: parsed.value, role: access.role ?? 'viewer' }
}

export async function readJourneys(db: Db, projectId: string, days: number, now = new Date()): Promise<JourneysResponse> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString()
  const until = new Date(now.getTime() + 5 * 60_000).toISOString()
  const [viewsRes, latestRes, doneRes, brokenRes, liveUrl, recordingRes] = await Promise.all([
    // A bare .limit() stops at PostgREST max_rows (1,000); page through it.
    readAllPages<PageViewRow>(
      (lo, hi, count) =>
        db
          .from('session_page_views')
          .select('session_id, route, ts', { count })
          .eq('project_id', projectId)
          .gte('ts', since)
          .lte('ts', until)
          .order('ts', { ascending: false })
          .order('id', { ascending: false })
          .range(lo, hi),
      { what: 'session_page_views', maxRows: VIEW_SAMPLE },
    ),
    db
      .from('site_structure_scans')
      .select('id, status, base_url, page_count, error, created_at, finished_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('site_structure_scans')
      .select('id, status, base_url, page_count, error, created_at, finished_at, pages')
      .eq('project_id', projectId)
      .eq('status', 'done')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Filed findings only, as Home and the site-watch page count them (ADR 0029).
    db.from('site_watch_pages').select('url').eq('project_id', projectId).is('resolved_at', null).or('confirmed_at.not.is.null,report_id.not.is.null').limit(200),
    liveUrlFor(db, projectId),
    db.from('project_settings').select('journey_recording_until, journey_recording_sample').eq('project_id', projectId).maybeSingle(),
  ])
  // Before the recording migration lands the columns are missing; the map still loads.
  if (recordingRes.error) log.warn('journeys: recording read failed', { projectId, err: recordingRes.error.message })
  if (latestRes.error) throw latestRes.error
  if (doneRes.error) throw doneRes.error
  // The watch is optional; without it the map just has no broken pages.
  if (brokenRes.error) log.warn('journeys: site_watch_pages read failed', { projectId, err: brokenRes.error.message })

  const views = viewsRes.rows
  const done = doneRes.data as ScanRow | null
  const latest = latestRes.data as ScanRow | null
  const stale = latest?.status === 'running' && now.getTime() - Date.parse(latest.created_at) > SCAN_STALE_MS
  const map = buildJourneyMap({
    views,
    viewsSampled: viewsRes.truncated,
    scan: done ? { rootPath: rootPathOf(done.base_url), pages: Array.isArray(done.pages) ? done.pages : [] } : null,
    brokenUrls: ((brokenRes.data ?? []) as Array<{ url: string }>).map((r) => r.url),
    now,
  })
  return {
    days,
    liveUrl,
    scan: latest ? { ...toSummary(latest), ...(stale ? { status: 'failed' as const, error: 'The scan stopped before it finished. Scan again.' } : {}) } : null,
    mapScan: done ? toSummary(done) : null,
    recording: recordingOf(recordingRes.error ? null : (recordingRes.data as RecordingRow | null), now),
    map,
  }
}

function toSummary(r: ScanRow): ScanSummary {
  return {
    id: r.id,
    status: r.status,
    baseUrl: r.base_url,
    pageCount: r.page_count ?? 0,
    error: r.error,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  }
}

/** The path of the start page: "/" or the app's base path on a shared host. */
export function rootPathOf(baseUrl: string): string {
  try {
    return normalizeRoute(new URL(baseUrl).pathname) ?? '/'
  } catch {
    return '/'
  }
}

/** The app's live address, from the same places Home reads it. */
async function liveUrlFor(db: Db, projectId: string): Promise<string | null> {
  const [watch, audit, settings, crawl] = await Promise.all([
    db.from('site_watches').select('base_url').eq('project_id', projectId).maybeSingle(),
    db.from('site_audits').select('base_url').eq('project_id', projectId).maybeSingle(),
    db.from('project_settings').select('crawler_base_url').eq('project_id', projectId).maybeSingle(),
    db.from('story_map_runs').select('base_url').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const candidates = [
    watch.data?.base_url as string | undefined,
    audit.data?.base_url as string | undefined,
    settings.data?.crawler_base_url as string | null | undefined,
    crawl.data?.base_url as string | undefined,
  ]
  return candidates.find((u): u is string => !!u && /^https?:\/\//i.test(u)) ?? null
}

/** Scan the live site and store its structure. Never throws: failures land on the row. */
export async function runScan(db: Db, projectId: string, scanId: string, baseUrl: string): Promise<void> {
  try {
    const mapped = await firecrawlMapOwnSite(db, projectId, baseUrl, { limit: 200 })
    const urls = pickCrawlUrls(mapped, baseUrl, SCAN_MAX_PAGES)
    const raw: Array<{ url: string; path: string; title: string | null; markdown: string; links: string[] }> = []
    let fatal: string | null = null
    for (let i = 0; i < urls.length && !fatal; i += SCAN_CONCURRENCY) {
      const batch = urls.slice(i, i + SCAN_CONCURRENCY)
      const results = await Promise.allSettled(batch.map((u) => firecrawlScrapeOwnSite(db, projectId, u, baseUrl, { links: true })))
      results.forEach((r, j) => {
        const url = batch[j]!
        if (r.status === 'fulfilled') {
          const path = normalizeRoute(url)
          if (!path) return
          raw.push({
            url,
            path,
            title: r.value.title?.trim() || null,
            markdown: r.value.markdown ?? '',
            links: internalPaths(r.value.links ?? [], url, baseUrl),
          })
        } else {
          const msg = r.reason instanceof Error ? r.reason.message : String(r.reason)
          // A missing or rejected key fails the scan; one bad page does not.
          if (msg === 'FIRECRAWL_NOT_CONFIGURED' || msg === 'FIRECRAWL_AUTH_FAILED') fatal = msg
          else log.warn('journeys.scan: page failed', { projectId, url, err: msg.slice(0, 200) })
        }
      })
    }
    if (fatal) throw new Error(fatal)
    if (raw.length === 0) throw new Error('NO_PAGES')

    const boiler = boilerplateLines(raw.map((p) => p.markdown))
    const seen = new Set<string>()
    const pages: ScannedPage[] = []
    for (const p of raw) {
      if (seen.has(p.path)) continue
      seen.add(p.path)
      const words = ownWords(p.markdown, boiler)
      pages.push({ path: p.path, url: p.url, title: p.title, links: p.links, words: words.length, sig: minhash(words) })
    }

    const { error } = await db
      .from('site_structure_scans')
      .update({ status: 'done', pages, page_count: pages.length, finished_at: new Date().toISOString() })
      .eq('id', scanId)
    if (error) throw new Error(`save failed: ${error.message}`)
    await pruneScans(db, projectId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await db
      .from('site_structure_scans')
      .update({ status: 'failed', error: scanErrorText(msg), finished_at: new Date().toISOString() })
      .eq('id', scanId)
      .then(({ error }) => {
        if (error) log.error('journeys.scan: could not record the failure', { projectId, scanId, err: error.message })
      })
  }
}

export function scanErrorText(code: string): string {
  if (code === 'FIRECRAWL_NOT_CONFIGURED') return 'No Firecrawl key. Add one in Settings → AI keys; it can be shared with all your apps.'
  if (code === 'FIRECRAWL_AUTH_FAILED') return 'Firecrawl rejected the key. Check it in Settings → AI keys.'
  if (code === 'FIRECRAWL_RATE_LIMITED') return 'Firecrawl is rate-limiting this key. Try again in a few minutes.'
  if (code === 'NO_PAGES') return 'No page could be read. Check that the address opens in a browser without signing in.'
  return `The scan failed: ${code.slice(0, 200)}`
}

async function pruneScans(db: Db, projectId: string): Promise<void> {
  const { data } = await db
    .from('site_structure_scans')
    .select('id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .range(KEEP_SCANS, KEEP_SCANS + 50)
  const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
  if (ids.length > 0) await db.from('site_structure_scans').delete().in('id', ids)
}
