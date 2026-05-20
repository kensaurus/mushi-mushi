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
//   POST /v1/sync/codebase/upload     — upload a source file to the RAG index
//   GET  /v1/sync/lessons/:id         — single lesson detail
//
// Note: /v1/sync/lessons (list) is registered in lessons.ts to co-locate
//       all lesson logic. /v1/sync/lessons/:id is here to avoid spreading
//       sync routing across files unnecessarily.
// ============================================================

import type { Hono } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import { getServiceClient } from '../../_shared/db.ts'
import { apiKeyAuth } from '../../_shared/auth.ts'

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const TriageBody = z.object({
  status: z
    .enum(['new', 'triaged', 'in_progress', 'resolved', 'dismissed'])
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

export function registerSyncRoutes(app: Hono) {
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
    const STATUS_BUCKETS = ['new', 'triaged', 'in_progress', 'resolved', 'dismissed'] as const
    const SEVERITY_BUCKETS = ['critical', 'high', 'medium', 'low'] as const

    const [statusResults, severityResults, fixCountRes, mergedFixRes, lessonCountRes] = await Promise.all([
      Promise.all(
        STATUS_BUCKETS.map((s) =>
          db
            .from('reports')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', projectId)
            .eq('status', s)
            .then((r) => ({ key: s, count: r.count ?? 0 })),
        ),
      ),
      Promise.all(
        SEVERITY_BUCKETS.map((sev) =>
          db
            .from('reports')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', projectId)
            .eq('severity', sev)
            .then((r) => ({ key: sev, count: r.count ?? 0 })),
        ),
      ),
      db
        .from('fixes')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId),
      db
        .from('fixes')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('status', 'merged'),
      db
        .from('lessons')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .is('retired_at', null),
    ])

    const byStatus = Object.fromEntries(statusResults.map((r) => [r.key, r.count]))
    const bySeverity = Object.fromEntries(severityResults.map((r) => [r.key, r.count]))
    // Use DB counts — fixCountRes.count is always exact regardless of row limits
    const fixesMerged = mergedFixRes.count ?? 0

    return c.json({
      ok: true,
      data: {
        project_id: projectId,
        project_name: projectName,
        by_status: byStatus,
        by_severity: bySeverity,
        fixes_count: fixCountRes.count ?? 0,
        fixes_merged: fixesMerged,
        lessons_count: lessonCountRes.count ?? 0,
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
      const escaped = search.replace(/[%_]/g, '\\$&')
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
    const id = c.req.param('id')

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
    let fix_id: string | null = null
    if (data.report_group_id) {
      const { data: group } = await db
        .from('report_groups')
        .select('fix_id')
        .eq('id', data.report_group_id)
        .maybeSingle()
      fix_id = group?.fix_id ?? null
    }

    return c.json({ ok: true, data: { ...data, fix_id } })
  })

  // ── PATCH /v1/sync/reports/:id ────────────────────────────────────────────
  // Update report status, severity, and/or add an internal note.
  // Maps to `mushi reports triage/resolve/reopen/dismiss` CLI commands.
  app.patch('/v1/sync/reports/:id', apiKeyAuth, async (c) => {
    const db = getServiceClient()
    const projectId = c.get('projectId') as string
    const id = c.req.param('id')

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
    if (status !== undefined) updates['status'] = status
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

    return c.json({ ok: true, data: updated })
  })

  // ── GET /v1/sync/lessons/:id ──────────────────────────────────────────────
  // Single lesson detail including the full summary paragraph.
  // Used by `mushi lessons show <id>`.
  app.get('/v1/sync/lessons/:id', apiKeyAuth, async (c) => {
    const db = getServiceClient()
    const projectId = c.get('projectId') as string
    const id = c.req.param('id')

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
  // Used by `mushi index <path>`. The legacy admin route
  // (/v1/admin/codebase/upload) requires jwtAuth — this sync variant accepts
  // the SDK API key so that CI pipelines don't need a user session.
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

    // Chunk the source into ~500-token segments with 50-token overlap.
    const CHUNK_SIZE = 2000
    const OVERLAP = 200
    const chunks: string[] = []
    for (let i = 0; i < source.length; i += CHUNK_SIZE - OVERLAP) {
      chunks.push(source.slice(i, i + CHUNK_SIZE))
    }

    // Delete stale chunks for this file before inserting the fresh batch.
    // The combination (project_id, file_path) uniquely identifies a file.
    await db
      .from('codebase_chunks')
      .delete()
      .eq('project_id', projectId)
      .eq('file_path', filePath)

    if (chunks.length > 0) {
      const rows = chunks.map((chunk, idx) => ({
        project_id: projectId,
        file_path: filePath,
        chunk_index: idx,
        content: chunk,
        created_at: new Date().toISOString(),
      }))
      const { error } = await db.from('codebase_chunks').insert(rows)
      if (error) {
        return c.json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
      }
    }

    return c.json({ ok: true, data: { chunks: chunks.length, file_path: filePath } })
  })
}
