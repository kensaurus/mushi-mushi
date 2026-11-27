/**
 * FILE: packages/server/supabase/functions/_shared/ux-timeline.ts
 * PURPOSE: Plan 025 P1 / ADR 0072: the app's iteration timeline, with no I/O.
 *          Which screenshot of each screen is pinned to a release (a copy
 *          under <project>/baselines/), which pinned shots the retention sweep
 *          drops, and how releases, closed reports, UX runs, kept UX changes
 *          and baselines merge into one rail of points.
 *
 * No model call anywhere here: the timeline is images and numbers.
 *
 * The rail's points are the app's releases when it has any (with an
 * "Unreleased" point for work after the newest one), otherwise its UX runs:
 * most founders never write a release row, and the page must not be empty
 * for them.
 */

import { scorecardSurfaceKey } from './ux-surface-key.ts'

export const UX_BASELINE_DEFAULT_KEEP = 24
/** Screenshots one pin request copies (120 screens × 2 viewports). */
export const UX_BASELINE_PIN_MAX = 240
export const TIMELINE_MAX_POINTS = 48
export const TIMELINE_MONTH_DAYS = 30
export type TimelineViewport = 'desktop' | 'mobile'
export const TIMELINE_VIEWPORTS: readonly TimelineViewport[] = ['desktop', 'mobile']

const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/

/** Pure: a release or version label the API accepts ("1.4.0", "v2026.11.27", "build-812"). */
export function validVersion(v: unknown): v is string {
  return typeof v === 'string' && VERSION_RE.test(v.trim())
}

/** Pure: one screen's key across runs. A page is its path (scorecard and loop agree); a tab, dialog or menu keeps the loop's key. */
export function timelineSurfaceKey(row: { kind: string; path: string; surface_key: string }): string {
  return row.kind === 'page' ? scorecardSurfaceKey(row.path) : row.surface_key
}

/** Pure: a file-name-safe version slug. */
export function versionSlug(version: string): string {
  return version.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'v'
}

/** Pure: where a pinned copy lives. The run id suffix keeps a re-pin from overwriting a file a row still names. */
export function baselineCapturePath(projectId: string, surfaceKey: string, viewport: TimelineViewport, version: string, runId: string, ext: 'png' | 'jpg'): string {
  return `${projectId}/baselines/${surfaceKey}/${viewport}/${versionSlug(version)}-${runId.replace(/-/g, '').slice(0, 8)}.${ext}`
}

export interface CaptureSourceRow {
  run_id: string
  run_kind: string
  /** The loop run's PR merged: its kept version is what users have. */
  run_pr_merged: boolean
  surface_key: string
  kind: string
  path: string
  label: string
  status: string
  score: number | null
  penalty_before: number | null
  penalty_after: number | null
  capture_hash: string | null
  cost_usd: number | string | null
  thumbs: Record<string, unknown> | null
  /** Scorecard pages: the viewport the page was captured at. */
  facts_viewport_width: number | null
}

export interface BaselineCandidate {
  surfaceKey: string
  path: string
  label: string
  viewport: TimelineViewport
  sourcePath: string
  ext: 'png' | 'jpg'
  score: number | null
  penalty: number | null
  captureHash: string | null
  runId: string
  costUsd: number | null
}

function asPath(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= 500 && !v.includes('..') ? v : null
}

function extOf(path: string): 'png' | 'jpg' {
  return path.toLowerCase().endsWith('.jpg') ? 'jpg' : 'png'
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * Pure: the bucket path of the screenshot that shows what users see on this
 * screen at this viewport, or null.
 *   - Loop run: the kept version once its PR merged, else the original.
 *   - Scorecard run: the settled shot (`thumbs.scorecard` names, stored
 *     relative to `<project>/<run>/scorecard/`), at the viewport it was taken.
 */
export function captureFor(row: CaptureSourceRow, viewport: TimelineViewport, projectId: string): string | null {
  const thumbs = row.thumbs ?? {}
  if (row.run_kind === 'scorecard') {
    const names = Array.isArray(thumbs.scorecard) ? (thumbs.scorecard as unknown[]).map(asPath).filter((n): n is string => !!n) : []
    const width = row.facts_viewport_width ?? 1440
    if ((width >= 768 ? 'desktop' : 'mobile') !== viewport) return null
    const name = names.find((n) => /\/settled\.(png|jpg)$/.test(n)) ?? names[0]
    return name ? `${projectId}/${row.run_id}/scorecard/${name}` : null
  }
  const after = asPath(thumbs[`after-${viewport}`])
  const before = asPath(thumbs[`before-${viewport}`])
  const shipped = row.status === 'accepted' && row.run_pr_merged
  return shipped ? (after ?? before) : (before ?? after)
}

/**
 * Pure: one capture per (screen, viewport) to pin, newest run first (the
 * caller orders `rows` by run start, newest first). At most
 * UX_BASELINE_PIN_MAX.
 */
export function pickBaselineCaptures(rows: readonly CaptureSourceRow[], projectId: string, only?: ReadonlySet<string>): BaselineCandidate[] {
  const seen = new Set<string>()
  const out: BaselineCandidate[] = []
  for (const row of rows) {
    const surfaceKey = timelineSurfaceKey(row)
    if (only && !only.has(surfaceKey)) continue
    for (const viewport of TIMELINE_VIEWPORTS) {
      const id = `${surfaceKey}|${viewport}`
      if (seen.has(id)) continue
      const sourcePath = captureFor(row, viewport, projectId)
      if (!sourcePath || !sourcePath.startsWith(`${projectId}/`)) continue
      seen.add(id)
      out.push({
        surfaceKey,
        path: row.path.slice(0, 500),
        label: row.label.slice(0, 300),
        viewport,
        sourcePath,
        ext: extOf(sourcePath),
        score: row.score,
        penalty: row.run_kind === 'scorecard' ? null : (row.status === 'accepted' && row.run_pr_merged ? row.penalty_after : row.penalty_before) ?? null,
        captureHash: row.capture_hash,
        runId: row.run_id,
        costUsd: num(row.cost_usd),
      })
      if (out.length >= UX_BASELINE_PIN_MAX) return out
    }
  }
  return out
}

export interface BaselineSweepRow {
  id: string
  surface_key: string
  viewport: string
  created_at: string
  pinned: boolean
  capture_path: string
}

/**
 * Pure: the baselines past the newest `keep` of their (screen, viewport).
 * A pinned row is never dropped (it still counts toward `keep`).
 */
export function baselinesToSweep(rows: readonly BaselineSweepRow[], keep: number): BaselineSweepRow[] {
  const k = Math.max(1, Math.floor(keep))
  const groups = new Map<string, BaselineSweepRow[]>()
  for (const r of rows) {
    const id = `${r.surface_key}|${r.viewport}`
    const g = groups.get(id)
    if (g) g.push(r)
    else groups.set(id, [r])
  }
  const drop: BaselineSweepRow[] = []
  for (const g of groups.values()) {
    g.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    for (const r of g.slice(k)) if (!r.pinned) drop.push(r)
  }
  return drop
}

// ── The rail ────────────────────────────────────────────────────────────────

export interface TimelineReleaseRow {
  id: string
  version: string
  title: string | null
  status: string
  published_at: string | null
  created_at: string
  fixed_report_ids: string[] | null
}

export interface TimelineRunRow {
  id: string
  local_run_id: string
  kind: string
  status: string
  started_at: string
  cost_usd: number | string | null
  cost: { judged?: number; cached?: number } | null
  /** Mean page score of a scorecard run (computed by the caller from its pages). */
  mean_score: number | null
  /** Screens with a kept change (loop runs). */
  improved: number
}

export interface TimelineReportRow {
  id: string
  title: string
  fixed_at: string
}

export interface TimelineBaselineRow {
  id: string
  surface_key: string
  path: string
  label: string
  viewport: string
  version: string
  release_id: string | null
  run_id: string | null
  score: number | null
  penalty: number | null
  cost_usd: number | string | null
  pinned: boolean
  created_at: string
  capture_path: string
}

export interface TimelinePoint {
  id: string
  kind: 'release' | 'run' | 'unreleased'
  at: string
  label: string
  title: string | null
  status: string | null
  version: string | null
  runs: Array<{ id: string; local_run_id: string; kind: string; cost_usd: number | null }>
  /** Sum of the runs' recorded costs; null when no run in the window recorded one. */
  cost_usd: number | null
  judged: number
  cached: number
  /** Mean page score of the newest scorecard run in the window. */
  score: number | null
  improved_screens: number
  reports_closed: number
  reports: Array<{ id: string; title: string }>
  baselines: number
}

export interface TimelineFrame {
  baseline_id: string
  point_id: string | null
  version: string
  viewport: string
  created_at: string
  score: number | null
  penalty: number | null
  cost_usd: number | null
  pinned: boolean
  capture_path: string
}

export interface TimelineSurface {
  key: string
  label: string
  path: string
  latest_score: number | null
  first_score: number | null
  frames: TimelineFrame[]
}

export interface TimelineMonth {
  since: string
  releases: number
  reports_closed: number
  top_reports: Array<{ id: string; title: string }>
  screens_improved: number
  runs: number
  cost_usd: number | null
  judged: number
  cached: number
  movers: Array<{ key: string; label: string; from: number; to: number }>
}

export interface PageScoreRow {
  run_id: string
  started_at: string
  surface_key: string
  label: string
  score: number
}

export interface Timeline {
  points: TimelinePoint[]
  surfaces: TimelineSurface[]
  month: TimelineMonth
  /** 'releases' when the rail is the app's releases, 'runs' when it falls back to UX runs. */
  rail: 'releases' | 'runs'
}

const ms = (iso: string) => new Date(iso).getTime()

function addCost(a: number | null, b: number | null): number | null {
  if (b == null) return a
  return Math.round(((a ?? 0) + b) * 1e6) / 1e6
}

function emptyPoint(p: Pick<TimelinePoint, 'id' | 'kind' | 'at' | 'label' | 'title' | 'status' | 'version'>): TimelinePoint {
  return { ...p, runs: [], cost_usd: null, judged: 0, cached: 0, score: null, improved_screens: 0, reports_closed: 0, reports: [], baselines: 0 }
}

function addRun(p: TimelinePoint, r: TimelineRunRow, newestScorecard: { at: number }): void {
  const cost = num(r.cost_usd)
  p.runs.push({ id: r.id, local_run_id: r.local_run_id, kind: r.kind, cost_usd: cost })
  p.cost_usd = addCost(p.cost_usd, cost)
  p.judged += Math.max(0, Number(r.cost?.judged ?? 0)) || 0
  p.cached += Math.max(0, Number(r.cost?.cached ?? 0)) || 0
  p.improved_screens += r.improved
  if (r.mean_score != null && ms(r.started_at) >= newestScorecard.at) {
    p.score = Math.round(r.mean_score * 10) / 10
    newestScorecard.at = ms(r.started_at)
  }
}

/**
 * Pure: merge everything into the rail (oldest → newest), the filmstrip per
 * screen and the last 30 days. `releases`, `runs`, `reports`, `baselines`
 * and `pageScores` may come in any order.
 */
export function buildTimeline(input: {
  releases: readonly TimelineReleaseRow[]
  runs: readonly TimelineRunRow[]
  reports: readonly TimelineReportRow[]
  baselines: readonly TimelineBaselineRow[]
  pageScores: readonly PageScoreRow[]
  now: Date
}): Timeline {
  const releases = [...input.releases]
    .map((r) => ({ ...r, at: r.published_at ?? r.created_at }))
    .sort((a, b) => ms(a.at) - ms(b.at))
  const runs = [...input.runs].filter((r) => r.status !== 'running' && r.status !== 'queued').sort((a, b) => ms(a.started_at) - ms(b.started_at))
  const reports = [...input.reports].sort((a, b) => ms(a.fixed_at) - ms(b.fixed_at))
  const rail: Timeline['rail'] = releases.length ? 'releases' : 'runs'
  const points: TimelinePoint[] = []
  const reportById = new Map(reports.map((r) => [r.id, r]))

  if (rail === 'releases') {
    let prev = -Infinity
    const claimed = new Set<string>()
    for (const rel of releases) {
      const at = ms(rel.at)
      const p = emptyPoint({ id: `release:${rel.id}`, kind: 'release', at: rel.at, label: rel.version, title: rel.title, status: rel.status, version: rel.version })
      const newest = { at: -Infinity }
      for (const r of runs) if (ms(r.started_at) > prev && ms(r.started_at) <= at) addRun(p, r, newest)
      // The release's own list wins; without one, the reports fixed since the previous release.
      const listed = (rel.fixed_report_ids ?? []).filter((id) => !claimed.has(id))
      const ids = listed.length ? listed : reports.filter((r) => ms(r.fixed_at) > prev && ms(r.fixed_at) <= at && !claimed.has(r.id)).map((r) => r.id)
      for (const id of ids) claimed.add(id)
      p.reports_closed = ids.length
      p.reports = ids.map((id) => ({ id, title: reportById.get(id)?.title ?? 'Report' })).slice(0, 5)
      points.push(p)
      prev = at
    }
    const after = runs.filter((r) => ms(r.started_at) > prev)
    const fixedAfter = reports.filter((r) => ms(r.fixed_at) > prev && !claimed.has(r.id))
    if (after.length || fixedAfter.length) {
      const last = [...after.map((r) => r.started_at), ...fixedAfter.map((r) => r.fixed_at)].sort((a, b) => ms(a) - ms(b)).at(-1)!
      const p = emptyPoint({ id: 'unreleased', kind: 'unreleased', at: last, label: 'Unreleased', title: 'Since the last release', status: null, version: null })
      const newest = { at: -Infinity }
      for (const r of after) addRun(p, r, newest)
      p.reports_closed = fixedAfter.length
      p.reports = fixedAfter.slice(-5).reverse().map((r) => ({ id: r.id, title: r.title }))
      points.push(p)
    }
  } else {
    let prev = -Infinity
    for (const r of runs) {
      const at = ms(r.started_at)
      const p = emptyPoint({ id: `run:${r.id}`, kind: 'run', at: r.started_at, label: r.started_at.slice(0, 10), title: r.kind === 'scorecard' ? 'Scorecard run' : r.kind === 'fresh_eyes' ? 'First-time user test' : 'UX run', status: r.status, version: null })
      addRun(p, r, { at: -Infinity })
      const fixed = reports.filter((x) => ms(x.fixed_at) > prev && ms(x.fixed_at) <= at)
      p.reports_closed = fixed.length
      p.reports = fixed.slice(-5).reverse().map((x) => ({ id: x.id, title: x.title }))
      points.push(p)
      prev = at
    }
  }
  const shown = points.slice(-TIMELINE_MAX_POINTS)

  // Baselines → the point they belong to: their release, the release of the same version, else their run.
  const relByVersion = new Map(releases.map((r) => [r.version, r.id]))
  const pointOf = (b: TimelineBaselineRow): string | null => {
    const rel = b.release_id ?? relByVersion.get(b.version) ?? null
    if (rel && rail === 'releases') return `release:${rel}`
    if (b.run_id && rail === 'runs') return `run:${b.run_id}`
    return null
  }
  const pointIds = new Set(shown.map((p) => p.id))
  const byKey = new Map<string, TimelineSurface>()
  for (const b of [...input.baselines].sort((x, y) => ms(x.created_at) - ms(y.created_at))) {
    const pid = pointOf(b)
    const s = byKey.get(b.surface_key) ?? { key: b.surface_key, label: b.label, path: b.path, latest_score: null, first_score: null, frames: [] }
    s.label = b.label || s.label
    s.frames.push({
      baseline_id: b.id,
      point_id: pid && pointIds.has(pid) ? pid : null,
      version: b.version,
      viewport: b.viewport,
      created_at: b.created_at,
      score: b.score,
      penalty: b.penalty,
      cost_usd: num(b.cost_usd),
      pinned: b.pinned,
      capture_path: b.capture_path,
    })
    if (b.score != null) {
      s.first_score ??= b.score
      s.latest_score = b.score
    }
    byKey.set(b.surface_key, s)
    if (pid) {
      const p = shown.find((x) => x.id === pid)
      if (p && b.viewport === 'desktop') p.baselines++
    }
  }
  const surfaces = [...byKey.values()].sort((a, b) => b.frames.length - a.frames.length || a.label.localeCompare(b.label))

  return { points: shown, surfaces, month: monthSummary(input, releases, runs, reports), rail }
}

function monthSummary(
  input: { pageScores: readonly PageScoreRow[]; now: Date },
  releases: ReadonlyArray<TimelineReleaseRow & { at: string }>,
  runs: readonly TimelineRunRow[],
  reports: readonly TimelineReportRow[],
): TimelineMonth {
  const since = new Date(input.now.getTime() - TIMELINE_MONTH_DAYS * 24 * 60 * 60 * 1000)
  const sinceMs = since.getTime()
  const inMonth = runs.filter((r) => ms(r.started_at) >= sinceMs)
  const fixed = reports.filter((r) => ms(r.fixed_at) >= sinceMs)
  let cost: number | null = null
  let judged = 0
  let cached = 0
  for (const r of inMonth) {
    cost = addCost(cost, num(r.cost_usd))
    judged += Number(r.cost?.judged ?? 0) || 0
    cached += Number(r.cost?.cached ?? 0) || 0
  }
  // Each page's first and last score this month; the biggest moves first.
  const byPage = new Map<string, PageScoreRow[]>()
  for (const s of input.pageScores) {
    if (ms(s.started_at) < sinceMs) continue
    const g = byPage.get(s.surface_key)
    if (g) g.push(s)
    else byPage.set(s.surface_key, [s])
  }
  const movers: TimelineMonth['movers'] = []
  for (const [key, g] of byPage) {
    if (g.length < 2) continue
    g.sort((a, b) => ms(a.started_at) - ms(b.started_at))
    const from = g[0].score
    const to = g[g.length - 1].score
    if (from !== to) movers.push({ key, label: g[g.length - 1].label, from, to })
  }
  movers.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from) || b.to - b.from)
  return {
    since: since.toISOString(),
    releases: releases.filter((r) => ms(r.at) >= sinceMs).length,
    reports_closed: fixed.length,
    top_reports: fixed.slice(-5).reverse().map((r) => ({ id: r.id, title: r.title })),
    screens_improved: inMonth.reduce((n, r) => n + r.improved, 0),
    runs: inMonth.length,
    cost_usd: cost,
    judged,
    cached,
    movers: movers.slice(0, 5),
  }
}

/** Pure: a run's mean page score, one decimal, or null. */
export function meanScore(scores: readonly number[]): number | null {
  if (!scores.length) return null
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
}
