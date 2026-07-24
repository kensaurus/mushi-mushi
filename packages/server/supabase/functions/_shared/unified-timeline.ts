/**
 * Unified report timeline — merges reporter comments, fix events, skill/QA pipeline
 * steps, and Ask Mushi turns into one ordered feed without merging underlying tables.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export type UnifiedTimelineLane =
  | 'report'
  | 'reporter_comment'
  | 'admin_comment'
  | 'fix'
  | 'qa'
  | 'skill_pipeline'
  | 'ask_mushi'
  // Telemetry lanes (Phase 1c): SDK-captured events merged by wall-clock timestamp.
  // These give the AI diagnosis agent a full causal picture: what the user did,
  // what network requests fired, and what the backend observed — all in one feed.
  | 'breadcrumb' // SDK breadcrumbs: navigation, click, lifecycle, custom
  | 'console'    // console.error / console.warn captured by the SDK
  | 'span'       // backend span lifecycle events (from backend_spans table)

/** Provenance: which system produced this timeline entry and how confident we are. */
export interface UnifiedTimelineProvenance {
  /** The system that produced this entry. */
  source: 'sdk' | 'sentry' | 'backend' | 'mushi'
  /** The specific SDK hook or capture mechanism, e.g. 'fetch-patch', 'console-wrap', 'breadcrumb-auto'. */
  capture_hook?: string
}

export interface UnifiedTimelineEntry {
  id: string
  lane: UnifiedTimelineLane
  at: string
  title: string
  body?: string | null
  status?: string | null
  actor?: string | null
  links?: Record<string, string>
  /** Added in Phase 1c: which system emitted this event and via which hook. */
  provenance?: UnifiedTimelineProvenance
}

export async function buildUnifiedReportTimeline(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
): Promise<UnifiedTimelineEntry[]> {
  const entries: UnifiedTimelineEntry[] = []

  // Phase 1c: include telemetry columns in the initial report fetch so we can merge
  // breadcrumbs, console errors, and backend spans into the timeline without a 2nd round-trip.
  const { data: report } = await db
    .from('reports')
    .select('id, status, description, category, created_at, breadcrumbs, console_logs, custom_metadata, sentry_trace_id')
    .eq('id', reportId)
    .eq('project_id', projectId)
    .maybeSingle()

  if (!report) return []

  entries.push({
    id: `report-${report.id}`,
    lane: 'report',
    at: report.created_at,
    title: 'Report submitted',
    body: report.description,
    status: report.status,
    actor: 'reporter',
  })

  const { data: comments } = await db
    .from('report_comments')
    .select('id, body, author_kind, created_at')
    .eq('report_id', reportId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
    .limit(200)

  for (const c of comments ?? []) {
    entries.push({
      id: `comment-${c.id}`,
      lane: c.author_kind === 'admin' ? 'admin_comment' : 'reporter_comment',
      at: c.created_at,
      title: c.author_kind === 'admin' ? 'Team reply' : 'Reporter reply',
      body: c.body,
      actor: c.author_kind,
    })
  }

  // `report_groups` has no `fix_id` column — the canonical fix linkage is the
  // most-recent `fix_attempts` row for this report.
  const { data: fixRow } = await db
    .from('fix_attempts')
    .select('id')
    .eq('report_id', reportId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const fixId: string | null = fixRow?.id ?? null

  if (fixId) {
    const { data: fixEvents } = await db
      .from('fix_events')
      .select('id, kind, label, detail, status, at')
      .eq('fix_attempt_id', fixId)
      .order('at', { ascending: true })
      .limit(100)

    for (const e of fixEvents ?? []) {
      entries.push({
        id: `fix-${e.id ?? e.kind}-${e.at}`,
        lane: 'fix',
        at: e.at,
        title: e.label ?? e.kind,
        body: e.detail,
        status: e.status,
        links: { fix_id: fixId },
      })
    }
  }

  // QA runs are keyed by `story_id`, not `report_id`. Resolve the stories that
  // originated from this report (`qa_stories.origin_report_id`) and pull their runs.
  const { data: reportStories } = await db
    .from('qa_stories')
    .select('id')
    .eq('project_id', projectId)
    .eq('origin_report_id', reportId)
    .limit(20)

  const storyIds = (reportStories ?? []).map((s) => s.id)
  if (storyIds.length > 0) {
    const { data: qaRuns } = await db
      .from('qa_story_runs')
      .select('id, status, started_at, finished_at, error_message')
      .in('story_id', storyIds)
      .order('started_at', { ascending: true })
      .limit(20)

    for (const run of qaRuns ?? []) {
      entries.push({
        id: `qa-${run.id}`,
        lane: 'qa',
        at: run.finished_at ?? run.started_at,
        title: `QA run ${run.status}`,
        body: run.error_message,
        status: run.status,
        links: { run_id: run.id },
      })
    }
  }

  const { data: pipelines } = await db
    .from('skill_pipeline_runs')
    .select('id, status, created_at, root_skill_slug')
    .eq('report_id', reportId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
    .limit(20)

  for (const p of pipelines ?? []) {
    entries.push({
      id: `pipeline-${p.id}`,
      lane: 'skill_pipeline',
      at: p.created_at,
      title: `Skill pipeline: ${p.root_skill_slug ?? 'workflow'}`,
      status: p.status,
      links: { pipeline_run_id: p.id },
    })
  }

  // Ask Mushi turns anchor to an entity via `selection_id` (text); there is no
  // dedicated `report_id` column.
  const { data: askTurns } = await db
    .from('ask_mushi_messages')
    .select('id, role, content, created_at')
    .eq('project_id', projectId)
    .eq('selection_id', reportId)
    .order('created_at', { ascending: true })
    .limit(50)

  for (const m of askTurns ?? []) {
    entries.push({
      id: `ask-${m.id}`,
      lane: 'ask_mushi',
      at: m.created_at,
      title: m.role === 'user' ? 'Ask Mushi question' : 'Ask Mushi answer',
      body: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      actor: m.role,
    })
  }

  // ── Phase 1c: Telemetry lanes ─────────────────────────────────────────────
  // Merge SDK-captured evidence events (breadcrumbs, console errors, backend spans)
  // into the timeline so AI agents and human readers see the full causal sequence:
  //   user action → SDK event → network request → backend span → error → report.
  // Only error/warn console entries are included to avoid noise (not all 50 log entries).
  // Breadcrumbs use their wall-clock timestamp; backend_spans use ingested_at.
  // `report` already contains these columns from the select above — no extra round-trip.

  // Breadcrumbs: navigation, click, lifecycle, custom — entire ring buffer.
  const breadcrumbs = report.breadcrumbs as Array<{
    timestamp: number
    category: string
    level: string
    message: string
    data?: Record<string, unknown>
  }> | null
  for (const b of breadcrumbs ?? []) {
    const isoAt = new Date(b.timestamp).toISOString()
    // Sentry-forwarded crumbs (category starts with 'sentry') get sentry provenance.
    const isSentry = b.category?.startsWith('sentry')
    entries.push({
      id: `breadcrumb-${b.timestamp}-${b.category}`,
      lane: 'breadcrumb',
      at: isoAt,
      title: `${b.category}: ${b.message}`,
      body: b.data ? JSON.stringify(b.data) : null,
      status: b.level,
      actor: isSentry ? 'sentry' : 'reporter',
      provenance: {
        source: isSentry ? 'sentry' : 'sdk',
        capture_hook: 'breadcrumb-auto',
      },
    })
  }

  // Console logs: only error and warn entries (keeps the timeline focused on signals).
  const consoleLogs = report.console_logs as Array<{
    level: string
    message: string
    timestamp: number
    stack?: string
  }> | null
  for (const log of consoleLogs ?? []) {
    if (log.level !== 'error' && log.level !== 'warn') continue
    entries.push({
      id: `console-${log.timestamp}-${log.level}`,
      lane: 'console',
      at: new Date(log.timestamp).toISOString(),
      title: `console.${log.level}: ${String(log.message).slice(0, 120)}`,
      body: log.stack ?? null,
      status: log.level,
      actor: 'sdk',
      provenance: {
        source: 'sdk',
        capture_hook: 'console-wrap',
      },
    })
  }

  // Backend spans: join on trace_id extracted from sentry_trace_id or traceparent.
  const customMeta = report.custom_metadata as Record<string, unknown> | null
  const rawTraceparent = typeof customMeta?.traceparent === 'string' ? customMeta.traceparent : null
  const traceparentTraceId = rawTraceparent ? (rawTraceparent.split('-')[1] ?? null) : null
  const sentryTraceId = typeof report.sentry_trace_id === 'string' ? report.sentry_trace_id : null
  const traceIds = Array.from(
    new Set([traceparentTraceId, sentryTraceId].filter((t): t is string => Boolean(t))),
  )

  if (traceIds.length > 0) {
    const { data: spans } = await db
      .from('backend_spans')
      .select('id, trace_id, span_json, ingested_at')
      .eq('project_id', projectId)
      .in('trace_id', traceIds)
      .order('ingested_at', { ascending: true })
      .limit(50)

    for (const s of spans ?? []) {
      const spanJson = s.span_json as {
        name?: string
        status?: string
        duration_ms?: number
        spanId?: string
      } | null
      entries.push({
        id: `span-${s.id}`,
        lane: 'span',
        at: s.ingested_at,
        title: spanJson?.name ?? `span ${s.trace_id.slice(0, 8)}`,
        body: spanJson?.duration_ms != null ? `${spanJson.duration_ms}ms` : null,
        status: spanJson?.status ?? null,
        actor: 'backend',
        provenance: {
          source: 'backend',
          capture_hook: 'otel-middleware',
        },
      })
    }
  }

  entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  return entries
}
