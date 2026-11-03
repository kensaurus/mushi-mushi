/**
 * FILE: sentry-reconcile.ts
 * PURPOSE: Catch Sentry up with reports that are already closed in Mushi.
 *
 * Resolving or archiving the linked Sentry issue happens when a report closes
 * (sentry-resolve-back.ts). That moment can be missed: the status-change side
 * effects ran without EdgeRuntime.waitUntil until 2026-11-03, cleanups closed
 * reports straight in the database, and Sentry can be down when a fix merges.
 * On 2026-11-03, 36 Sentry links were still open on reports Mushi had fixed
 * or closed as not a bug, so Sentry kept listing them as unresolved.
 *
 * The Sentry poll calls this every 15 minutes, after its import, so a report
 * the import just reopened is read as open here. It handles at most `batch`
 * reports per run and rotates through the backlog, so an issue Sentry keeps
 * refusing cannot starve the others. Failures log as warnings (`quiet`).
 * Only the Sentry poll imports this module, which keeps the `api` bundle the
 * same size.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { log as rootLog } from './logger.ts';
import {
  archiveLinkedSentryIssues,
  loadSentryCredentials,
  resolveLinkedSentryIssues,
  sentryCloseAction,
  type SentryArchiveResult,
  type SentryBackDeps,
  type SentryCredentials,
  type SentryResolveBackResult,
} from './sentry-resolve-back.ts';

const log = rootLog.child('sentry-reconcile');

/** Reports handled per run. Each one costs up to two Sentry calls per link. */
export const RECONCILE_BATCH = 10;
/** How often the Sentry poll runs; the rotation moves one batch per run. */
export const RECONCILE_INTERVAL_MS = 15 * 60_000;
/** Open links read per run before the batch is picked. */
const RECONCILE_SCAN = 200;

const RESOLVE_STATUSES = new Set(['fixed', 'resolved', 'verified']);

/** What a closed report means for its still-open Sentry issue. */
export function reconcileAction(status: string, closedReason: string | null | undefined): 'resolve' | 'archive' | null {
  if (RESOLVE_STATUSES.has(status)) return 'resolve';
  if (status === 'dismissed' && sentryCloseAction(closedReason) === 'archive') return 'archive';
  return null;
}

interface ReportRef {
  status: string;
  closed_reason: string | null;
}

interface LinkRow {
  report_id: string;
  project_id: string;
  external_id: string;
  /** A many-to-one embed is one object at runtime; supabase-js types it as an array. */
  reports: ReportRef | ReportRef[] | null;
}

export interface ReconcileSummary {
  /** Reports with an open Sentry link that should be closed. */
  pending: number;
  reports: number;
  resolved: number;
  archived: number;
  gone: number;
  failed: number;
}

export async function reconcileSentryLinks(
  db: SupabaseClient,
  deps: {
    batch?: number;
    now?: () => number;
    resolve?: (db: SupabaseClient, input: Parameters<typeof resolveLinkedSentryIssues>[1], deps?: SentryBackDeps) => Promise<SentryResolveBackResult>;
    archive?: (db: SupabaseClient, input: Parameters<typeof archiveLinkedSentryIssues>[1], deps?: SentryBackDeps) => Promise<SentryArchiveResult>;
    credentials?: (db: SupabaseClient, projectId: string) => Promise<SentryCredentials | null>;
  } = {},
): Promise<ReconcileSummary> {
  const resolve = deps.resolve ?? resolveLinkedSentryIssues;
  const archive = deps.archive ?? archiveLinkedSentryIssues;
  const batch = Math.max(1, deps.batch ?? RECONCILE_BATCH);

  const { data, error } = await db
    .from('report_external_issues')
    .select('report_id, project_id, external_id, reports!inner(status, closed_reason)')
    .eq('system', 'sentry')
    .is('resolved_at', null)
    .is('archived_at', null)
    .in('reports.status', ['fixed', 'resolved', 'verified', 'dismissed'])
    .order('created_at', { ascending: true })
    .limit(RECONCILE_SCAN);
  if (error) throw new Error(`Sentry reconcile lookup failed: ${error.message}`);

  // One entry per report: resolve and archive handle all of a report's links.
  const byReport = new Map<string, { reportId: string; projectId: string; action: 'resolve' | 'archive'; closedReason: string | null }>();
  for (const row of (data ?? []) as unknown as LinkRow[]) {
    const report = Array.isArray(row.reports) ? row.reports[0] : row.reports;
    if (!/^\d+$/.test(row.external_id) || !report || byReport.has(row.report_id)) continue;
    const action = reconcileAction(report.status, report.closed_reason);
    if (action) byReport.set(row.report_id, { reportId: row.report_id, projectId: row.project_id, action, closedReason: report.closed_reason });
  }
  const pending = [...byReport.values()];
  const summary: ReconcileSummary = { pending: pending.length, reports: 0, resolved: 0, archived: 0, gone: 0, failed: 0 };
  if (pending.length === 0) return summary;

  // Rotate by run so a link that always fails does not hold the front.
  const run = Math.floor((deps.now ?? Date.now)() / RECONCILE_INTERVAL_MS);
  const start = (run * batch) % pending.length;
  const picked = [...pending.slice(start), ...pending.slice(0, start)].slice(0, batch);

  // Credentials once per project per run.
  const credCache = new Map<string, Promise<SentryCredentials | null>>();
  const credentials = (d: SupabaseClient, projectId: string) => {
    if (!credCache.has(projectId)) credCache.set(projectId, (deps.credentials ?? loadSentryCredentials)(d, projectId));
    return credCache.get(projectId)!;
  };
  const backDeps: SentryBackDeps = { credentials, quiet: true };

  for (const item of picked) {
    summary.reports++;
    try {
      if (item.action === 'resolve') {
        const r = await resolve(
          db,
          { projectId: item.projectId, reportId: item.reportId, fixAttemptId: null, prUrl: null, note: 'the report was already closed in Mushi, so Mushi caught Sentry up.' },
          backDeps,
        );
        summary.resolved += r.resolved.length;
        summary.gone += r.gone?.length ?? 0;
        summary.failed += r.failed.length;
      } else {
        const r = await archive(db, { projectId: item.projectId, reportId: item.reportId, closedReason: item.closedReason as string }, backDeps);
        summary.archived += r.archived.length;
        summary.gone += r.gone?.length ?? 0;
        summary.failed += r.failed.length;
      }
    } catch (err) {
      summary.failed++;
      log.warn('Sentry reconcile failed for a report', { reportId: item.reportId, err: String(err).slice(0, 200) });
    }
  }
  if (summary.failed > 0) log.warn('Sentry reconcile left some issues open', { ...summary });
  else log.info('Sentry reconcile', { ...summary });
  return summary;
}
