/**
 * FILE: packages/server/supabase/functions/_shared/ux-scorecard-io.ts
 * PURPOSE: The UX scorecard's wire shapes and rows (ADR 0067), with no I/O:
 *          what the CLI sends (a run and its pages), which rows they become
 *          (ux_runs kind 'scorecard', one ux_surfaces row per page), where a
 *          page's screenshots live, and the `ux_scorecard` report a root cause
 *          files. The rubric itself is in ux-scorecard.ts.
 *
 * Pure apart from zod: vitest imports it directly.
 */

import { z } from 'npm:zod@3'
import { causeReportBody, scorecardPageKey, UX_DIMENSIONS, UX_SCORECARD_PROMPT_VERSION, type UxCause, type UxPageFacts, type UxPageScore } from './ux-scorecard.ts'

export const UX_SCORECARD_RUN_ID_RE = /^[0-9]{8}-[0-9]{6}-[a-z0-9]{4}$/
export const UX_SCORECARD_REPORTER = 'ux-scorecard'
/** Pages one run may hold. */
export const UX_SCORECARD_MAX_PAGES = 120
export const UX_SCORECARD_DEFAULT_VIEWPORT = '1440x900'
/** Open reports Mushi's scorecard may hold per app; past it a run refreshes, never adds. */
export const UX_SCORECARD_OPEN_CAP = 15
export const UX_SCORECARD_OPEN_STATUSES = ['new', 'queued', 'pending', 'submitted', 'classified', 'triaged', 'grouped', 'reopened', 'fixing', 'in_progress'] as const

const VIEWPORT_RE = /^([0-9]{3,4})x([0-9]{3,4})$/

/** Pure: "1440x900" as a viewport, or null. */
export function parseViewport(v: unknown): { width: number; height: number } | null {
  const m = typeof v === 'string' ? VIEWPORT_RE.exec(v.trim()) : null
  if (!m) return null
  const width = Number(m[1])
  const height = Number(m[2])
  return width >= 320 && width <= 3840 && height >= 320 && height <= 2400 ? { width, height } : null
}

/** Pure: a ux_surfaces.surface_key for a page key: lower-case slug, at most 120 characters, unique enough per run. */
export function scorecardSurfaceKey(pageKey: string): string {
  const slug = pageKey.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join('-') || 'root'
  if (slug.length <= 110) return slug
  let h = 0
  for (const ch of pageKey) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return `${slug.slice(0, 100)}-${h.toString(36)}`
}

const SHOT_RE = /^[a-z0-9][a-z0-9-]{0,119}\/(?:early|settled)\.(?:png|jpg)$/

/** Pure: storage path of one page screenshot (`<surfaceKey>/<early|settled>.png`), or null for any other name. */
export function scorecardShotPath(projectId: string, runRowId: string, name: string): string | null {
  return SHOT_RE.test(name) ? `${projectId}/${runRowId}/scorecard/${name}` : null
}

const Facts = z.object({
  key: z.string().min(1).max(500),
  path: z.string().startsWith('/').max(500),
  label: z.string().max(300),
  title: z.string().max(300),
  breadcrumb: z.string().max(300).optional(),
  headings: z.array(z.string().max(200)).max(40),
  text: z.string().max(12_000),
  controls: z.array(z.string().max(120)).max(120),
  earlyText: z.string().max(4000).optional(),
  settleMs: z.number().int().min(0).max(600_000).nullable(),
  axe: z.object({ critical: z.number().int().min(0), serious: z.number().int().min(0), rules: z.array(z.string().max(80)).max(30) }).nullable(),
  overflowX: z.boolean(),
  consoleErrors: z.number().int().min(0).max(10_000),
  cls: z.number().min(0).max(100),
  viewport: z.object({ width: z.number().int().min(200).max(4000), height: z.number().int().min(200).max(4000) }),
})

const Dim = z.enum(UX_DIMENSIONS)
const Sev = z.enum(['high', 'medium', 'low'])

const Issue = z.object({
  dimension: Dim,
  severity: Sev,
  title: z.string().max(200),
  problem: z.string().max(800),
  evidence: z.string().max(500),
  fix: z.string().max(800),
  cause: z.string().max(200),
  confidence: z.number().min(0).max(1),
  evidenceSeen: z.boolean(),
})

const Score = z.object({
  key: z.string().max(500),
  page: z.string().max(300),
  scores: z.record(Dim, z.number().int().min(1).max(10)),
  why: z.record(Dim, z.string().max(400)).default({}),
  capped: z.record(Dim, z.number().int().min(1).max(10)).default({}),
  overall: z.number().int().min(1).max(10),
  issues: z.array(Issue).max(5),
  claims: z.array(z.object({ subject: z.string().max(200), value: z.string().max(300) })).max(12),
  promptVersion: z.string().max(80),
})

const CausePage = z.object({ key: z.string().max(500), label: z.string().max(300), issueTitle: z.string().max(200), evidence: z.string().max(500) })

const Cause = z.object({
  patternKey: z.string().regex(/^ux:[a-z]+:[a-z0-9-]{1,120}$/),
  dimension: Dim,
  severity: Sev,
  kind: z.enum(['shared', 'contradiction', 'page']),
  title: z.string().max(300),
  problem: z.string().max(800),
  fix: z.string().max(800),
  pages: z.array(CausePage).min(1).max(UX_SCORECARD_MAX_PAGES),
  confidence: z.number().min(0).max(1),
  evidenceSeen: z.boolean(),
})

export const UxScorecardPage = z.object({
  facts: Facts,
  /** Scored on the caller's machine (a local transport); omit to score it on the server. */
  score: Score.nullable().optional(),
  /** Screenshot names already uploaded for this page. */
  shots: z.array(z.string().max(160)).max(2).default([]),
  /** Why this page could not be captured, when it could not. */
  error: z.string().max(500).optional(),
})
export type UxScorecardPage = z.infer<typeof UxScorecardPage>

export const UxScorecardSnapshot = z.object({
  status: z.enum(['running', 'done', 'failed', 'stopped']),
  start_url: z.string().url().max(500),
  viewport: z.string().regex(VIEWPORT_RE),
  /** Who scored the pages: 'server' (the platform route), or the local transport and its model. */
  scored_by: z.string().max(120),
  cli_version: z.string().max(40).optional(),
  started_at: z.string().datetime({ offset: true }),
  finished_at: z.string().datetime({ offset: true }).nullable().optional(),
  error: z.string().max(1000).nullable().optional(),
  pages: z.array(UxScorecardPage).max(UX_SCORECARD_MAX_PAGES),
  causes: z.array(Cause).max(60).optional(),
})
export type UxScorecardSnapshot = z.infer<typeof UxScorecardSnapshot>

export const UxScorecardFacts = Facts
export const UxScorecardCauses = z.array(Cause).max(60)

/** Pure: the ux_runs row of a scorecard run. */
export function scorecardRunRow(s: UxScorecardSnapshot, ctx: { projectId: string; localRunId: string; userId: string; now: Date }): Record<string, unknown> {
  const scored = s.pages.filter((p) => p.score)
  const mean = scored.length ? scored.reduce((n, p) => n + (p.score?.overall ?? 0), 0) / scored.length : null
  return {
    project_id: ctx.projectId,
    local_run_id: ctx.localRunId,
    created_by: ctx.userId,
    kind: 'scorecard',
    mode: 'local',
    agent: UX_SCORECARD_REPORTER,
    model: s.scored_by.slice(0, 120),
    status: s.status,
    start_url: s.start_url,
    detail: `viewport ${s.viewport}`,
    cli_version: s.cli_version ?? null,
    counts: { pages: s.pages.length, scored: scored.length, failed: s.pages.filter((p) => p.error).length, mean: mean == null ? null : Math.round(mean * 10) / 10, causes: s.causes?.length ?? 0, prompt: UX_SCORECARD_PROMPT_VERSION },
    ...(s.causes ? { findings: s.causes } : {}),
    error: s.error ?? null,
    started_at: s.started_at,
    finished_at: s.finished_at ?? null,
    updated_at: ctx.now.toISOString(),
  }
}

/** Pure: the ux_surfaces row of one page. */
export function scorecardSurfaceRow(p: UxScorecardPage, ctx: { projectId: string; runRowId: string; now: Date }): Record<string, unknown> {
  const key = scorecardPageKey(p.facts.key)
  return {
    run_id: ctx.runRowId,
    project_id: ctx.projectId,
    surface_key: scorecardSurfaceKey(key),
    kind: 'page',
    path: key.slice(0, 500),
    label: (p.facts.label || key).slice(0, 300),
    status: p.error ? 'blocked' : p.score ? 'baseline' : 'pending',
    note: p.error ? p.error.slice(0, 1000) : null,
    facts: p.facts,
    ...(p.score ? { score: p.score.overall, scorecard: p.score } : {}),
    thumbs: p.shots.length ? { scorecard: p.shots } : null,
    updated_at: ctx.now.toISOString(),
  }
}

/** Pure: the `reports` row one root cause files (source 'ux_scorecard'). */
export function scorecardReportRow(
  c: UxCause,
  ctx: { reportId: string; projectId: string; actorId: string; localRunId: string; baseUrl: string; pageScores: Readonly<Record<string, number>>; now: Date },
): Record<string, unknown> {
  const body = causeReportBody(c, { baseUrl: ctx.baseUrl, runId: ctx.localRunId, pageScores: ctx.pageScores })
  const at = ctx.now.toISOString()
  return {
    id: ctx.reportId,
    project_id: ctx.projectId,
    title: body.title,
    description: body.description,
    category: 'visual',
    user_category: 'visual',
    severity: body.severity,
    component: body.component,
    environment: { platform: 'ux_scorecard' },
    custom_metadata: { source: 'ux_scorecard', run: ctx.localRunId, dimension: c.dimension, kind: c.kind, confidence: c.confidence, prompt: UX_SCORECARD_PROMPT_VERSION },
    pattern_key: c.patternKey,
    affected_screens: affectedScreens(c, ctx.pageScores, at),
    status: 'new',
    source: 'ux_scorecard',
    reporter_token_hash: UX_SCORECARD_REPORTER,
    reporter_user_id: ctx.actorId,
    synced_at: at,
    created_at: at,
  }
}

/** Pure: reports.affected_screens for a cause (ADR 0065's shape, with the page score). */
export function affectedScreens(c: UxCause, pageScores: Readonly<Record<string, number>>, at: string): Array<Record<string, unknown>> {
  return c.pages.slice(0, 50).map((p) => ({ screen: p.label, file: p.key, title: p.issueTitle, evidence: p.evidence.slice(0, 300), score: pageScores[p.key] ?? null, at }))
}

/** Pure: a row read back from ux_surfaces as the rubric's ScoredPage, or null when unscored. */
export function scoredPageFromRow(row: { path: string; label: string; scorecard: unknown; facts: unknown }): { key: string; label: string; score: UxPageScore; facts?: UxPageFacts } | null {
  const s = Score.safeParse(row.scorecard)
  if (!s.success) return null
  const f = Facts.safeParse(row.facts)
  return { key: row.path, label: row.label, score: s.data as UxPageScore, ...(f.success ? { facts: f.data as UxPageFacts } : {}) }
}
