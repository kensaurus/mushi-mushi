/**
 * FILE: packages/server/supabase/functions/api/routes/report-sentry.ts
 * PURPOSE: Close a closed report's Sentry issues from the report page, so a
 *          person never has to open Sentry to finish a bug Mushi already
 *          closed (owner, 2026-10-30: "everything should be done from the
 *          console"). A fixed report resolves its issues; a dismissed one
 *          archives them until they escalate, whatever the close reason
 *          (the automatic archive on close covers only "works as intended"
 *          and "won't fix", sentry-resolve-back.ts).
 *
 * Served by api-ext (api size budget); `api` forwards the path.
 */

import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { jwtAuth } from '../../_shared/auth.ts';
import { logAudit } from '../../_shared/audit.ts';
import { archiveLinkedSentryIssues, resolveLinkedSentryIssues } from '../../_shared/sentry-resolve-back.ts';
import { dbError, parseUuidParam, userCanAccessProject } from '../shared.ts';
import { denyViewerWrite } from '../viewer-gate.ts';

/** What closing a report's Sentry issues does, by the report's status; null while the report is open. */
export function sentryCloseKind(status: string | null | undefined): 'resolve' | 'archive' | null {
  if (status === 'fixed' || status === 'resolved') return 'resolve';
  if (status === 'dismissed') return 'archive';
  return null;
}

export function registerReportSentryRoutes(app: Hono<{ Variables: Variables }>): void {
  app.post('/v1/admin/reports/:id/sentry/close', jwtAuth, async (c) => {
    const idParsed = parseUuidParam(c);
    if (!idParsed.ok) return idParsed.error;
    const reportId = idParsed.value;
    const userId = c.get('userId') as string;
    const db = getServiceClient();

    const { data: report, error } = await db
      .from('reports')
      .select('id, project_id, status, closed_reason')
      .eq('id', reportId)
      .maybeSingle();
    if (error) return dbError(c, error);
    if (!report) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404);
    const projectId = report.project_id as string;
    const access = await userCanAccessProject(db, userId, projectId);
    if (!access.allowed) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404);
    const viewerDenied = denyViewerWrite(c, access.role, 'close Sentry issues');
    if (viewerDenied) return viewerDenied;

    const kind = sentryCloseKind(report.status as string | null);
    if (!kind) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'REPORT_OPEN',
            message: 'Close the report first. Its Sentry issue resolves when the fix merges or the report is marked fixed.',
          },
        },
        409,
      );
    }

    const result =
      kind === 'resolve'
        ? await resolveLinkedSentryIssues(db, {
            projectId,
            reportId,
            fixAttemptId: null,
            prUrl: null,
            note: 'resolved from the report page by a console user.',
          })
        : await archiveLinkedSentryIssues(db, {
            projectId,
            reportId,
            closedReason: (report.closed_reason as string | null) ?? 'dismissed',
            byPerson: true,
          });
    const done = 'resolved' in result ? result.resolved : result.archived;
    if (result.skipped === 'no_credentials') {
      return c.json(
        {
          ok: false,
          error: { code: 'NO_SENTRY_TOKEN', message: 'Add a Sentry auth token and organization in Integrations → Sentry first.' },
        },
        409,
      );
    }
    if (done.length > 0) {
      await logAudit(db, projectId, userId, 'integration.synced', 'report', reportId, {
        system: 'sentry',
        action: kind,
        issues: done,
      }).catch(() => {});
    }
    return c.json({ ok: true, data: { kind, done, failed: result.failed, skipped: result.skipped ?? null } });
  });
}
