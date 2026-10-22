/**
 * FILE: packages/server/supabase/functions/api/routes/report-file.ts
 * PURPOSE: POST /v1/admin/projects/:id/reports — file a free-form report for
 *          one app from the console, the CLI (`mushi reports file`) or MCP
 *          (`file_report`). A console session or an `mcp:write` API key;
 *          viewers are read-only. At most FILED_REPORTS_PER_HOUR per app an
 *          hour. The report is stored with source 'api', queued for stage-1
 *          triage and classified like any other report; the audit log records
 *          who filed it and how.
 */

import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { log as rootLog } from '../../_shared/logger.ts'
import { logAudit } from '../../_shared/audit.ts'
import { callerCanAccessProject, dbError } from '../shared.ts'
import { denyViewerWrite } from '../viewer-gate.ts'
import { triggerClassification } from '../helpers.ts'
import {
  FILE_REPORT_RATE_SCOPE,
  FILED_REPORTS_PER_HOUR,
  filedReportRow,
  parseFileReportBody,
  type FiledVia,
} from '../../_shared/report-file.ts'

const log = rootLog.child('report-file')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function registerReportFileRoutes(app: Hono<{ Variables: Variables }>): void {
  app.post('/v1/admin/projects/:id/reports', adminOrApiKey({ scope: 'mcp:write' }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('id') ?? ''
    if (!UUID_RE.test(projectId)) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'project id must be a UUID' } }, 400)
    }

    let rawBody: unknown
    try {
      rawBody = await c.req.json()
    } catch {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
    }
    const parsed = parseFileReportBody(rawBody)
    if (!parsed.ok) return c.json({ ok: false, error: parsed.error }, 422)

    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } }, 403)
    }
    const viewerDenied = denyViewerWrite(c, access.role, 'file reports')
    if (viewerDenied) return viewerDenied

    // Per app, shared by every caller. A limiter error refuses the request
    // rather than letting an unbounded number of diagnoses through.
    const { error: rateErr } = await db.rpc('scoped_rate_limit_claim', {
      p_user_id: projectId,
      p_scope: FILE_REPORT_RATE_SCOPE,
      p_max_per_window: FILED_REPORTS_PER_HOUR,
      p_window: '1 hour',
    })
    if (rateErr) {
      const limited = (rateErr.message ?? '').includes('rate_limit_exceeded')
      if (!limited) log.warn('report file rate limit check failed', { projectId, err: rateErr.message })
      return c.json(
        {
          ok: false,
          error: {
            code: limited ? 'RATE_LIMITED' : 'RATE_LIMIT_UNAVAILABLE',
            message: limited
              ? `This app already had ${FILED_REPORTS_PER_HOUR} reports filed in the last hour. Try again later.`
              : 'The report was not filed. Retry in a moment.',
          },
        },
        limited ? 429 : 503,
      )
    }

    const via: FiledVia = c.get('authMethod') === 'apiKey' ? 'api_key' : 'console'
    const reportId = crypto.randomUUID()
    const row = filedReportRow(parsed.value, { reportId, projectId, actorId: userId, via, now: new Date() })
    const { error: insertError } = await db.from('reports').insert(row)
    if (insertError) return dbError(c, insertError)

    // The same triage an SDK report gets: a stage-1 queue row (the reconciler
    // retries from it) and the fast-filter call.
    const { error: queueError } = await db
      .from('processing_queue')
      .upsert(
        { report_id: reportId, project_id: projectId, stage: 'stage1', status: 'pending' },
        { onConflict: 'report_id,stage', ignoreDuplicates: true },
      )
    if (queueError && (queueError as { code?: string }).code !== '23505') {
      log.error('filed report not queued for classification', { reportId, errMsg: queueError.message })
    }
    triggerClassification(reportId, projectId)

    await logAudit(
      db,
      projectId,
      userId,
      'report.created',
      'report',
      reportId,
      { source: 'admin_file', via, severity: parsed.value.severity ?? null, component: parsed.value.component ?? null },
      { actorType: via === 'api_key' ? 'api_key' : 'user' },
    )
    log.info('report filed', { projectId, reportId, via })

    return c.json(
      {
        ok: true,
        data: {
          reportId,
          projectId,
          title: parsed.value.title,
          status: 'new',
          severity: parsed.value.severity ?? null,
          component: parsed.value.component ?? null,
        },
      },
      201,
    )
  })
}
