// ============================================================
// sync.ts — SDK / CLI sync endpoints (API-key authenticated, no JWT required)
//
// All routes here are authenticated via `apiKeyAuth` only.
// The API key is validated against `project_api_keys` and the projectId is
// resolved from the key's DB row — no JWT or scope check needed.
//
// Routes:
//   GET  /v1/sync/whoami              — verify key + return project info
//   GET  /v1/sync/stats               — project stats (report counts, fixes)
//   GET  /v1/sync/reports             — list reports with filters + search
//   GET  /v1/sync/reports/:id         — single report detail
//   PATCH /v1/sync/reports/:id        — triage: status, severity, note
//   POST /v1/sync/reports/:id/reply   — send a visible reply to the reporter widget
//   POST /v1/sync/codebase/upload     — upload a source file to the RAG index
//   GET  /v1/sync/lessons/:id         — single lesson detail
//
// Note: /v1/sync/lessons (list) is registered in lessons.ts to co-locate
//       all lesson logic. /v1/sync/lessons/:id is here to avoid spreading
//       sync routing across files unnecessarily.
// ============================================================

import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { z } from 'npm:zod@3'
import { getServiceClient } from '../../_shared/db.ts'
import { apiKeyAuth } from '../../_shared/auth.ts'
import { createNotification, buildNotificationMessage } from '../../_shared/notifications.ts'
import { normalizeSyncStatus, isReporterFixedStatus } from '../../_shared/report-status.ts'
import { buildUnifiedReportTimeline } from '../../_shared/unified-timeline.ts'

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const TriageBody = z.object({
  status: z
    .enum(['new', 'triaged', 'in_progress', 'resolved', 'dismissed', 'verified', 'reopened', 'fixed'])
    .optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  note: z.string().max(2000).optional(),
}).refine((b) => b.status !== undefined || b.severity !== undefined || b.note !== undefined, {
  message: 'Provide at least one of status, severity, or note',
})

const CodebaseUploadBody = z.object({
  filePath: z.string().max(1000),
  source: z.string().max(600_000),
  projectId: z.string().optional(), // ignored: projectId comes from the API key
})

// ─── Route registration ───────────────────────────────────────────────────────

export function registerSyncRoutes(app: Hono<{ Variables: Variables }>) {
  // ── GET /v1/sync/whoami ────────────────────────────────────────────────────
  // Verify the API key is valid and return which project it belongs to.
  // Used by `mushi whoami` and by any CI step that needs to confirm credentials.
  app.get('/v1/sync/whoami', apiKeyAuth, async (c) => {
    const db = getServiceClient()
    const projectId = c.get('projectId') as string
    const projectName = c.get('projectName') as string

    // Fetch a lightweight stats snapshot alongside the identity info.
    const [totalResult, openResult] = await Promise.all([
      db.from('reports').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
      db.from('reports').select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .in('status', ['new', 'triaged', 'in_progress']),
    ])

    return c.json({
      ok: true,
      data: {
        project_id: projectId,
        project_name: projectName,
        stats: {
          total_reports: totalResult.count ?? 0,
          open_reports: openResult.count ?? 0,
        },
      },
    })
  })

  // ── GET /v1/sync/stats ────────────────────────────────────────────────────
  // Summarised project health: report counts by status and severity, fix and
  // lesson totals. Powers `mushi status` in the CLI.
  app.get('/v1/sync/stats', apiKeyAuth, async (c) => {
    const db = getServiceClient()
    const projectId = c.get('projectId') as string
    const projectName = c.get('projectName') as string

    // Use DB-level HEAD count queries (no row data returned) so the counts are
    // always accurate even when a project has > max_rows (Supabase default 1000)
    // reports. Running them all in parallel keeps the latency equivalent to a
    // single round-trip.
    //
    // STATUS_BUCKETS must match the DB CHECK constraint on reports.status
    // (see phase0_initial_schema.sql). The user-facing labels returned to the
    // CLI map the internal pipeline statuses to readable names.
    const STATUS_BUCKETS = [
      'new', 'pending', 'submitted', 'queued',
      'classified', 'grouped', 'fixing', 'fixed', 'dismissed',
    ] as const
    // Severity can be NULL for reports that haven't been classified yet.
    // We count each named bucket plus an explicit 'unset' bucket for NULLs.
    const SEVERITY_BUCKETS = ['critical', 'high', 'medium', 'low'] as const

    // Each status/severity bucket query throws on DB error so Promise.all rejects
    // fast. Fix/lesson queries use the non-throwing pattern and are checked below.
    let statusResults: Array<{ key: string; count: number }>
    let severityResults: Array<{ key: string; count: number }>
    let unsetSeverityCount: number
    let fixCount: number
    let mergedFixCount: number
    let lessonCount: number
    try {
      const [sRes, sevRes, unsetSevRes, fixCountRes, mergedFixRes, lessonCountRes] = await Promise.all([
        Promise.all(
          STATUS_BUCKETS.map((s) =>
            db.from('reports').select('*', { count: 'exact', head: true })
              .eq('project_id', projectId).eq('status', s)
              .then((r) => {
                if (r.error) throw new Error(`stats status ${s}: ${r.error.message}`)
                return { key: s as string, count: r.count ?? 0 }
              }),
          ),
        ),
        Promise.all(
          SEVERITY_BUCKETS.map((sev) =>
            db.from('reports').select('*', { count: 'exact', head: true })
              .eq('project_id', projectId).eq('severity', sev)
              .then((r) => {
                if (r.error) throw new Error(`stats severity ${sev}: ${r.error.message}`)
                return { key: sev as string, count: r.count ?? 0 }
              }),
          ),
        ),
        // Count reports with no severity assigned yet (NULL severity).
        db.from('reports').select('*', { count: 'exact', head: true })
          .eq('project_id', projectId).is('severity', null)
          .then((r) => {
            if (r.error) throw new Error(`stats severity unset: ${r.error.message}`)
            return r
          }),
        db.from('fixes').select('*', { count: 'exact', head: true }).eq('project_id', projectId),
        db.from('fixes').select('*', { count: 'exact', head: true }).eq('project_id', projectId).eq('status', 'merged'),
        db.from('lessons').select('*', { count: 'exact', head: true }).eq('project_id', projectId).is('retired_at', null),
      ])

      if (fixCountRes.error) throw new Error(`stats fixes: ${fixCountRes.error.message}`)
      if (mergedFixRes.error) throw new Error(`stats fixes_merged: ${mergedFixRes.error.message}`)
      if (lessonCountRes.error) throw new Error(`stats lessons: ${lessonCountRes.error.message}`)

      statusResults = sRes
      severityResults = sevRes
      unsetSeverityCount = unsetSevRes.count ?? 0
      fixCount = fixCountRes.count ?? 0
      mergedFixCount = mergedFixRes.count ?? 0
      lessonCount = lessonCountRes.count ?? 0
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: msg } }, 500)
    }

    const byStatus = Object.fromEntries(statusResults.map((r) => [r.key, r.count]))
    const bySeverity = {
      ...Object.fromEntries(severityResults.map((r) => [r.key, r.count])),
      unset: unsetSeverityCount,
    }

    return c.json({
      ok: true,
      data: {
        project_id: projectId,
        project_name: projectName,
        by_status: byStatus,
        by_severity: bySeverity,
        fixes_count: fixCount,
        fixes_merged: mergedFixCount,
        lessons_count: lessonCount,
      },
    })
  })

  // ── GET /v1/sync/reports ──────────────────────────────────────────────────
  // List reports for the project. Supports pagination, status/severity filters,
  // and full-text search (ilike on summary and description).
  app.get('/v1/sync/reports', apiKeyAuth, async (c) => {
    const db = getServiceClient()
    const projectId = c.get('projectId') as string

    const limit = Math.min(parseInt(c.req.query('limit') ?? '20'), 100)
    const offset = parseInt(c.req.query('offset') ?? '0')
    const status = c.req.query('status')
    const severity = c.req.query('severity')
    const search = c.req.query('search')?.trim()

    let query = db
      .from('reports')
      .select(
        'id, project_id, description, category, severity, summary, status, created_at, ' +
        'environment, screenshot_url, component, tags, sentry_event_id, sentry_release',
        { count: 'exact' },
      )
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) query = query.eq('status', status)
    if (severity) query = query.eq('severity', severity)
    if (search) {
      // Bilateral ILIKE search across summary and description fields.
      // Strip commas in addition to % and _ — a comma in a PostgREST .or()
      // condition string splits the expression and can malform the query.
      const escaped = search.replace(/[%_,]/g, (c) => c === ',' ? ' ' : `\\${c}`)
      query = query.or(`summary.ilike.%${escaped}%,description.ilike.%${escaped}%`)
    }

    const { data, count, error } = await query
    if (error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    }

    return c.json({
      ok: true,
      data: {
        reports: data ?? [],
        total: count ?? 0,
        limit,
        offset,
      },
    })
  })

  // ── GET /v1/sync/reports/:id ──────────────────────────────────────────────
  // Full report detail. Includes environment, tags, breadcrumbs, linked fix.
  app.get('/v1/sync/reports/:id', apiKeyAuth, async (c) => {
    const db = getServiceClient()
    const projectId = c.get('projectId') as string
    const id = c.req.param('id')!

    const { data, error } = await db
      .from('reports')
      .select(
        'id, project_id, description, category, severity, summary, status, created_at, ' +
        'environment, screenshot_url, component, tags, breadcrumbs, ' +
        'sentry_event_id, sentry_release, sentry_environment, sentry_replay_id, ' +
        'report_group_id, last_reporter_reply_at, last_admin_reply_at',
      )
      .eq('id', id)
      .eq('project_id', projectId)   // prevent cross-project read
      .maybeSingle()

    if (error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    }
    if (!data) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: `Report ${id} not found` } }, 404)
    }

    // Attach linked fix ID if present, via the report_groups table.
    // Scope to project_id to prevent cross-project data leakage if a
    // report_group_id is ever corrupted or guessed.
    const row = data as unknown as Record<string, unknown>
    let fix_id: string | null = null
    if (row.report_group_id) {
      const { data: group } = await db
        .from('report_groups')
        .select('fix_id')
        .eq('id', row.report_group_id as string)
        .eq('project_id', projectId)
        .maybeSingle()
      fix_id = group?.fix_id ?? null
    }

    return c.json({ ok: true, data: { ...row, fix_id } })
  })

  // ── GET /v1/sync/reports/:id/timeline ─────────────────────────────────────
  // Unified developer-facing timeline across comments, fixes, QA, pipelines, Ask Mushi.
  app.get('/v1/sync/reports/:id/timeline', apiKeyAuth, async (c) => {
    const db = getServiceClient()
    const projectId = c.get('projectId') as string
    const id = c.req.param('id')!

    const { data: exists } = await db
      .from('reports')
      .select('id')
      .eq('id', id)
      .eq('project_id', projectId)
      .maybeSingle()

    if (!exists) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: `Report ${id} not found` } }, 404)
    }

    const timeline = await buildUnifiedReportTimeline(db, projectId, id)
    return c.json({ ok: true, data: { report_id: id, timeline } })
  })

  // ── PATCH /v1/sync/reports/:id ────────────────────────────────────────────
  // Update report status, severity, and/or add an internal note.
  // Maps to `mushi reports triage/resolve/reopen/dismiss` CLI commands.
  app.patch('/v1/sync/reports/:id', apiKeyAuth, async (c) => {
    const db = getServiceClient()
    const projectId = c.get('projectId') as string
    const id = c.req.param('id')!

    let rawBody: unknown
    try { rawBody = await c.req.json() } catch {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
    }

    const parsed = TriageBody.safeParse(rawBody)
    if (!parsed.success) {
      return c.json({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues.map((i) => i.message).join('; ') },
      }, 422)
    }

    const { status, severity, note } = parsed.data

    // Verify the report belongs to this project before mutating.
    const { data: existing, error: fetchErr } = await db
      .from('reports')
      .select('id, status, severity')
      .eq('id', id)
      .eq('project_id', projectId)
      .maybeSingle()

    if (fetchErr) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: fetchErr.message } }, 500)
    }
    if (!existing) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: `Report ${id} not found` } }, 404)
    }

    // Build the update payload, only setting fields explicitly provided.
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (status !== undefined) {
      const canonical = normalizeSyncStatus(status) ?? status
      updates['status'] = canonical === 'resolved' ? 'fixed' : canonical
    }
    if (severity !== undefined) updates['severity'] = severity

    const { data: updated, error: updateErr } = await db
      .from('reports')
      .update(updates)
      .eq('id', id)
      .eq('project_id', projectId)
      .select(
        'id, project_id, description, summary, severity, status, category, created_at, ' +
        'environment, component, tags, sentry_event_id',
      )
      .maybeSingle()

    if (updateErr) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: updateErr.message } }, 500)
    }

    // Persist the triage note to report_notes (if the table exists).
    // This is a best-effort write — we don't fail the PATCH if the insert fails.
    if (note) {
      await db.from('report_notes').insert({
        report_id: id,
        project_id: projectId,
        body: note,
        source: 'cli',
        created_at: new Date().toISOString(),
      }).then(() => null, () => null)
    }

    // Fire reporter notification when status changes to resolved or dismissed.
    // Mirrors the same trigger that reports-dashboard.ts fires from the admin UI,
    // so CLI triage also notifies the end-user widget.
    const canonicalStatus = status ? (normalizeSyncStatus(status) ?? status) : undefined
    if (
      canonicalStatus &&
      (isReporterFixedStatus(canonicalStatus) || canonicalStatus === 'dismissed') &&
      existing.status !== updates['status']
    ) {
      const notifType = isReporterFixedStatus(canonicalStatus) ? 'fixed' : 'dismissed'
      // reporter_token_hash is not on existing (select was minimal) — re-fetch it.
      db.from('reports')
        .select('reporter_token_hash')
        .eq('id', id)
        .eq('project_id', projectId)
        .maybeSingle()
        .then(({ data: r }) => {
          if (!r?.reporter_token_hash) return
          return createNotification(db, projectId, id, r.reporter_token_hash, notifType, {
            message: buildNotificationMessage(notifType, {}),
            reportId: id,
          })
        })
        .then(() => null, () => null)
    }

    return c.json({ ok: true, data: updated })
  })

  // ── POST /v1/sync/reports/:id/reply ──────────────────────────────────────
  // Send a message to the end-user reporter widget. Creates a comment that is
  // visible in the widget and fires a reporter_notification for the "New reply"
  // badge. Used by `mushi reports reply <id> "message"` and the reply_to_reporter
  // MCP tool so triage can happen from the Cursor IDE without opening the admin UI.
  app.post('/v1/sync/reports/:id/reply', apiKeyAuth, async (c) => {
    const db = getServiceClient()
    const projectId = c.get('projectId') as string
    const id = c.req.param('id')!

    let rawBody: unknown
    try { rawBody = await c.req.json() } catch {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
    }

    const ReplyBody = z.object({
      message: z.string().min(1).max(10_000),
      author_name: z.string().max(100).optional().default('Mushi Admin'),
    })

    const parsed = ReplyBody.safeParse(rawBody)
    if (!parsed.success) {
      return c.json({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues.map((i) => i.message).join('; ') },
      }, 422)
    }

    const { message, author_name } = parsed.data

    // Verify report belongs to this project and fetch the reporter token for the notification.
    const { data: report, error: fetchErr } = await db
      .from('reports')
      .select('id, status, reporter_token_hash')
      .eq('id', id)
      .eq('project_id', projectId)
      .maybeSingle()

    if (fetchErr) return c.json({ ok: false, error: { code: 'DB_ERROR', message: fetchErr.message } }, 500)
    if (!report) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: `Report ${id} not found` } }, 404)

    // API-key replies have no JWT caller — satisfy report_comments_author_well_formed
    // by attributing the comment to the project owner (same as a signed-in admin).
    const { data: project, error: projectErr } = await db
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .maybeSingle()

    if (projectErr) return c.json({ ok: false, error: { code: 'DB_ERROR', message: projectErr.message } }, 500)
    if (!project?.owner_id) {
      return c.json({
        ok: false,
        error: { code: 'MISCONFIGURED', message: 'Project has no owner_id — cannot post admin reply via API key' },
      }, 500)
    }

    const { data: comment, error: insertErr } = await db
      .from('report_comments')
      .insert({
        report_id: id,
        project_id: projectId,
        author_kind: 'admin',
        author_user_id: project.owner_id,
        author_name,
        body: message,
        visible_to_reporter: true,
        created_at: new Date().toISOString(),
      })
      .select('id, author_kind, author_name, body, visible_to_reporter, created_at')
      .single()

    if (insertErr) return c.json({ ok: false, error: { code: 'DB_ERROR', message: insertErr.message } }, 500)

    // Update last_admin_reply_at on the report — best effort.
    db.from('reports')
      .update({ last_admin_reply_at: new Date().toISOString() })
      .eq('id', id)
      .eq('project_id', projectId)
      .then(() => null, () => null)

    // Notify the reporter widget so they see the unread badge.
    if (report.reporter_token_hash) {
      createNotification(db, projectId, id, report.reporter_token_hash, 'comment_reply', {
        message: buildNotificationMessage('comment_reply', {}),
        reportId: id,
      }).catch(() => null)
    }

    return c.json({ ok: true, data: { comment } }, 201)
  })

  // ── GET /v1/sync/lessons/:id ──────────────────────────────────────────────
  // Single lesson detail including the full summary paragraph.
  // Used by `mushi lessons show <id>`.
  app.get('/v1/sync/lessons/:id', apiKeyAuth, async (c) => {
    const db = getServiceClient()
    const projectId = c.get('projectId') as string
    const id = c.req.param('id')!

    const { data, error } = await db
      .from('lessons')
      .select('id, rule_text, anti_pattern, summary_paragraph, severity, frequency, last_reinforced_at, cluster_id, promoted_at')
      .eq('id', id)
      .eq('project_id', projectId)   // prevent cross-project read
      .maybeSingle()

    if (error) {
      return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
    }
    if (!data) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: `Lesson ${id} not found` } }, 404)
    }

    return c.json({ ok: true, data })
  })

  // ── POST /v1/sync/codebase/upload ─────────────────────────────────────────
  // Ingest a single source file into the Mushi RAG vector index.
  // Used by `mushi index <path>`. The admin route (/v1/admin/codebase/upload)
  // requires a Supabase JWT — this sync variant accepts the SDK API key so
  // that CI pipelines don't need a browser session.
  //
  // Delegates to the same code-indexer + createEmbedding pipeline as the admin
  // route so both write to `project_codebase_files` with proper embeddings.
  app.post('/v1/sync/codebase/upload', apiKeyAuth, async (c) => {
    const db = getServiceClient()
    const projectId = c.get('projectId') as string

    let rawBody: unknown
    try { rawBody = await c.req.json() } catch {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
    }

    const parsed = CodebaseUploadBody.safeParse(rawBody)
    if (!parsed.success) {
      return c.json({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.issues.map((i) => i.message).join('; ') },
      }, 422)
    }

    const { filePath, source } = parsed.data

    if (source.length > 500_000) {
      return c.json({ ok: false, error: { code: 'TOO_LARGE', message: 'Source > 500 KB; skip large generated files' } }, 413)
    }

    const { chunk, shouldIndex, sha256Hex } = await import('../../_shared/code-indexer.ts')
    const { createEmbedding } = await import('../../_shared/embeddings.ts')

    if (!shouldIndex(filePath)) {
      return c.json({ ok: true, data: { chunks: 0, file_path: filePath, skipped: 'unsupported_extension' } })
    }

    const chunks = chunk(filePath, source)
    let inserted = 0
    const chunkErrors: string[] = []
    for (const ch of chunks) {
      try {
        const text = `${filePath}::${ch.symbolName ?? 'whole'}\n${ch.body}`
        const embedding = await createEmbedding(text, { projectId })
        const contentHash = await sha256Hex(ch.body)
        const { error } = await db.from('project_codebase_files').upsert(
          {
            project_id: projectId,
            file_path: filePath,
            symbol_name: ch.symbolName,
            signature: ch.signature,
            line_start: ch.lineStart,
            line_end: ch.lineEnd,
            language: ch.language,
            content_hash: contentHash,
            content_preview: ch.body.slice(0, 500),
            embedding,
            tombstoned_at: null,
          },
          { onConflict: 'project_id,file_path,symbol_name', ignoreDuplicates: false },
        )
        if (error) {
          chunkErrors.push(`${filePath}#${ch.symbolName ?? 'whole'}: ${error.message}`)
        } else {
          inserted++
        }
      } catch (err) {
        // Individual chunk failures don't abort the whole file. Collect errors
        // so the response includes a partial-success payload and callers can
        // detect degraded indexing without silent data loss.
        const msg = err instanceof Error ? err.message : String(err)
        chunkErrors.push(`${filePath}#${ch.symbolName ?? 'whole'}: ${msg}`)
      }
    }

    return c.json({
      ok: true,
      data: {
        chunks: inserted,
        file_path: filePath,
        ...(chunkErrors.length > 0 ? { chunk_errors: chunkErrors } : {}),
      },
    })
  })

  // ── GET /v1/sync/ingest-setup ─────────────────────────────────────────────
  // API-key view of the four **required ingest** steps (key → SDK heartbeat →
  // first report). Distinct from GET /v1/admin/projects/:id/preflight which
  // covers dispatch readiness (GitHub, codebase, BYOK, autofix). Powers
  // `mushi connect --wait`, `mushi doctor --ingest`, and MCP ingest_setup_check.
  app.get('/v1/sync/ingest-setup', apiKeyAuth, async (c) => {
    const db = getServiceClient()
    const projectId = c.get('projectId') as string
    const projectName = c.get('projectName') as string

    const adminHost = (() => {
      try {
        return new URL(c.req.url).host || null
      } catch {
        return null
      }
    })()

    const [keysRes, reportsRes, projectRes] = await Promise.all([
      db
        .from('project_api_keys')
        .select('last_seen_at, last_seen_origin, last_seen_user_agent, last_seen_endpoint_host')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .order('last_seen_at', { ascending: false, nullsFirst: false })
        .limit(1),
      db
        .from('reports')
        .select('id, environment, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(20),
      db.from('projects').select('slug').eq('id', projectId).maybeSingle(),
    ])

    // A failed query must not masquerade as a confident "step incomplete"
    // diagnosis — pollers would tell the user their SDK isn't installed.
    if (keysRes.error || reportsRes.error) {
      const detail = keysRes.error?.message ?? reportsRes.error?.message ?? 'query failed'
      return c.json(
        { ok: false, error: { code: 'DB_ERROR', message: `ingest-setup lookup failed: ${detail}` } },
        500,
      )
    }

    const heartbeat = keysRes.data?.[0] as {
      last_seen_at?: string | null
      last_seen_origin?: string | null
      last_seen_user_agent?: string | null
      last_seen_endpoint_host?: string | null
    } | undefined

    let reportCount = 0
    let sdkReportSignal = false
    for (const r of reportsRes.data ?? []) {
      reportCount += 1
      const env = (r.environment ?? {}) as Record<string, unknown>
      const platform = typeof env.platform === 'string' ? env.platform : ''
      if (platform && platform !== 'mushi-admin') sdkReportSignal = true
    }

    const hasKey = (keysRes.data?.length ?? 0) > 0
    const hasSdk = Boolean(heartbeat?.last_seen_at) || sdkReportSignal
    const hasReport = reportCount > 0

    type Step = {
      id: 'api_key_generated' | 'sdk_installed' | 'first_report_received' | 'project_created'
      label: string
      complete: boolean
      required: boolean
      hint: string
    }

    const steps: Step[] = [
      {
        id: 'project_created',
        label: 'Project exists',
        complete: true,
        required: true,
        hint: 'Project row is provisioned in Mushi.',
      },
      {
        id: 'api_key_generated',
        label: 'API key active',
        complete: hasKey,
        required: true,
        hint: hasKey
          ? 'At least one active API key is configured.'
          : 'Mint an API key in Projects → Generate key.',
      },
      {
        id: 'sdk_installed',
        label: 'SDK heartbeat',
        complete: hasSdk,
        required: true,
        hint: hasSdk
          ? 'SDK reached this backend (heartbeat or real report).'
          : 'Install the snippet, set env vars, restart your dev server.',
      },
      {
        id: 'first_report_received',
        label: 'First report ingested',
        complete: hasReport,
        required: true,
        hint: hasReport
          ? 'At least one report row exists for this project.'
          : 'Send a test report from Projects or open the banner in your app.',
      },
    ]

    const requiredSteps = steps.filter((s) => s.required)
    const requiredComplete = requiredSteps.filter((s) => s.complete).length

    return c.json({
      ok: true,
      data: {
        project_id: projectId,
        project_name: projectName,
        project_slug: projectRes.data?.slug ?? null,
        ready: requiredComplete === requiredSteps.length,
        required_total: requiredSteps.length,
        required_complete: requiredComplete,
        steps,
        recent_report_count: reportCount,
        diagnostic: {
          last_sdk_seen_at: heartbeat?.last_seen_at ?? null,
          last_sdk_origin: heartbeat?.last_seen_origin ?? null,
          last_sdk_user_agent: heartbeat?.last_seen_user_agent ?? null,
          last_sdk_endpoint_host: heartbeat?.last_seen_endpoint_host ?? null,
          admin_endpoint_host: adminHost,
        },
      },
    })
  })

  // ── GET /v1/sync/two-way-health ───────────────────────────────────────────
  app.get('/v1/sync/two-way-health', apiKeyAuth, async (c) => {
    const db = getServiceClient()
    const projectId = c.get('projectId') as string

    const [keysRes, unreadRes, repliesRes] = await Promise.all([
      db
        .from('project_api_keys')
        .select('last_seen_at, last_seen_user_agent')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .order('last_seen_at', { ascending: false, nullsFirst: false })
        .limit(1),
      // Reporter read-state lives on `reporter_notifications` (read_at), which is
      // raised on admin replies + status changes — there is no per-comment read
      // flag. Unread notifications are the proxy for "updates the reporter hasn't seen".
      db
        .from('reporter_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .is('read_at', null),
      db
        .from('report_comments')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('author_kind', 'admin')
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
    ])

    const heartbeat = keysRes.data?.[0]
    return c.json({
      ok: true,
      data: {
        last_sdk_heartbeat_at: heartbeat?.last_seen_at ?? null,
        last_sdk_user_agent: heartbeat?.last_seen_user_agent ?? null,
        unread_admin_replies: unreadRes.count ?? 0,
        admin_replies_7d: repliesRes.count ?? 0,
        healthy: Boolean(heartbeat?.last_seen_at),
      },
    })
  })
}
