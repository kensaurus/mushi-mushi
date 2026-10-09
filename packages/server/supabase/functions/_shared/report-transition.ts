/**
 * FILE: report-transition.ts
 * PURPOSE: One implementation of the "report status changed" side-effect
 *          contract, shared by every actor surface — the admin PATCH route
 *          (console + MCP transition_status both land there) and the Slack
 *          card buttons.
 *
 *          Keeps the contract in one place so surfaces never diverge: fire
 *          the `report.status_changed` plugin event, resolve linked external
 *          issues on resolve, and notify the reporter. All side effects are
 *          best-effort — a failed webhook must never roll back a status
 *          change the human already made.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { log } from './logger.ts';
import { normalizeAdminStatus, toStoredStatus } from './report-status.ts';
import { notifyReportStatusTransition } from './report-status-notify.ts';
import { resolveExternalIssue } from './integrations.ts';
import { archiveLinkedSentryIssues, reopenSentryLinks, resolveLinkedSentryIssues, sentryCloseAction } from './sentry-resolve-back.ts';

/** Statuses that close a report; leaving one reopens its Sentry links. */
const DONE_STATUSES = new Set(['fixed', 'resolved', 'verified', 'dismissed']);

/** True when a report leaves a done status for an open one. */
export function reopensReport(previousStatus: string, newStatus: string): boolean {
  return DONE_STATUSES.has(previousStatus) && !DONE_STATUSES.has(newStatus);
}
import { dispatchPluginEventDetached } from './plugins.ts';
import { closeReportPipelines, closesPipelines } from './report-pipelines-close.ts';

const transitionLog = log.child('report-transition');

export interface TransitionActor {
  kind: 'admin' | 'slack' | 'system';
  /** Console user id, Slack user id, or automation name. */
  id: string;
}

/**
 * Fire the full status-transition side-effect set. Call AFTER the row update
 * succeeded, and only when the stored status actually changed. `newStatus`
 * must already be the stored form (resolved → fixed).
 */
export function runStatusTransitionSideEffects(
  db: SupabaseClient,
  input: {
    reportId: string;
    projectId: string;
    reporterTokenHash: string | null;
    previousStatus: string;
    newStatus: string;
    actor: TransitionActor;
    /** Why a dismissed report was closed; forwarded to the reporter message. */
    closedReason?: string | null;
    /** False when the caller sends its own reporter message (release publish). */
    notifyReporter?: boolean;
  },
): void {
  // A reopened report's Sentry links count as open again, so a later "fixed"
  // resolves the issue in Sentry instead of skipping an old resolved_at.
  if (reopensReport(input.previousStatus, input.newStatus)) {
    reopenSentryLinks(db, input.projectId, input.reportId).catch((e: unknown) =>
      transitionLog.error('Reopening Sentry links failed', { reportId: input.reportId, err: String(e) }),
    );
  }
  try {
    dispatchPluginEventDetached(db, input.projectId, 'report.status_changed', {
      report: { id: input.reportId, status: input.newStatus },
      previousStatus: input.previousStatus,
      actor:
        input.actor.kind === 'admin'
          ? { kind: 'admin', userId: input.actor.id }
          : { kind: input.actor.kind, id: input.actor.id },
    }).catch((e) =>
      transitionLog.warn('Plugin dispatch failed', {
        event: 'report.status_changed',
        err: String(e),
      }),
    );
  } catch (e) {
    transitionLog.warn('Plugin dispatch failed (sync)', {
      event: 'report.status_changed',
      err: String(e),
    });
  }
  // `resolved` arrives here in its stored form `fixed`; both spell "done".
  if (input.newStatus === 'fixed' || input.newStatus === 'resolved') {
    resolveExternalIssue(input.reportId, input.projectId, db).catch((e: unknown) =>
      transitionLog.error('resolveExternalIssue failed', {
        reportId: input.reportId,
        err: String(e),
      }),
    );
    // Reports imported from Sentry are linked by issue id and resolved with the
    // project's own Sentry token (the merge path does the same). Without this,
    // marking such a report fixed by hand never reached Sentry.
    resolveLinkedSentryIssues(db, {
      projectId: input.projectId,
      reportId: input.reportId,
      fixAttemptId: null,
      prUrl: null,
      note: `marked fixed in Mushi by ${input.actor.kind === 'admin' ? 'a console user' : input.actor.kind}.`,
    })
      .then((r) => {
        if (r.failed.length) transitionLog.error('Sentry resolve on fixed failed', { reportId: input.reportId, failed: r.failed })
      })
      .catch((e: unknown) => transitionLog.error('Sentry resolve on fixed threw', { reportId: input.reportId, err: String(e) }));
  }
  // Closed as not-a-bug: archive the linked Sentry issue so it leaves
  // Sentry's unresolved list too (it comes back if it escalates).
  if (input.newStatus === 'dismissed' && sentryCloseAction(input.closedReason) === 'archive') {
    archiveLinkedSentryIssues(db, {
      projectId: input.projectId,
      reportId: input.reportId,
      closedReason: input.closedReason as string,
    })
      .then((r) => {
        if (r.failed.length) transitionLog.error('Sentry archive on close failed', { reportId: input.reportId, failed: r.failed })
      })
      .catch((e: unknown) => transitionLog.error('Sentry archive on close threw', { reportId: input.reportId, err: String(e) }));
  }

  if (closesPipelines(input.newStatus)) {
    closeReportPipelines(db, {
      reportId: input.reportId,
      projectId: input.projectId,
      reportStatus: input.newStatus,
    }).catch((e: unknown) =>
      transitionLog.warn('Closing the report pipelines failed', { reportId: input.reportId, err: String(e) }),
    );
  }
  if (input.reporterTokenHash && input.notifyReporter !== false) {
    notifyReportStatusTransition(db, {
      projectId: input.projectId,
      reportId: input.reportId,
      reporterTokenHash: input.reporterTokenHash,
      previousStatus: input.previousStatus,
      newStatus: input.newStatus,
      closedReason: input.closedReason ?? null,
    }).catch((e) =>
      transitionLog.error('Notification failed', { reportId: input.reportId, err: String(e) }),
    );
  }
}

export type TransitionResult =
  | { ok: true; previousStatus: string; storedStatus: string; changed: boolean }
  | { ok: false; code: 'INVALID_STATUS' | 'NOT_FOUND' | 'DB_ERROR'; message: string };

/**
 * Convenience for trusted server-side actors (Slack buttons): normalize the
 * status alias, persist the stored form, then run the side-effect contract.
 * The admin PATCH route keeps its own multi-field update and calls
 * `runStatusTransitionSideEffects` directly.
 */
export async function applyReportStatusTransition(
  db: SupabaseClient,
  input: {
    reportId: string;
    requestedStatus: string;
    actor: TransitionActor;
  },
): Promise<TransitionResult> {
  const normalized = normalizeAdminStatus(input.requestedStatus);
  if (!normalized) {
    return {
      ok: false,
      code: 'INVALID_STATUS',
      message: `Unknown status: ${input.requestedStatus}`,
    };
  }
  const storedStatus = normalized === 'resolved' ? 'fixed' : normalized;

  const { data: report } = await db
    .from('reports')
    .select('project_id, reporter_token_hash, status')
    .eq('id', input.reportId)
    .single();
  if (!report) {
    return { ok: false, code: 'NOT_FOUND', message: 'Report not found' };
  }

  const { error } = await db
    .from('reports')
    .update({ status: storedStatus })
    .eq('id', input.reportId);
  if (error) {
    return { ok: false, code: 'DB_ERROR', message: error.message };
  }

  // Compare on the stored canonical form (resolved is persisted as fixed) so
  // canonicalizing a legacy row isn't treated as a real transition —
  // otherwise it would re-award points and re-fire a `fixed` notification.
  const changed = storedStatus !== toStoredStatus(report.status);
  if (changed) {
    runStatusTransitionSideEffects(db, {
      reportId: input.reportId,
      projectId: report.project_id,
      reporterTokenHash: report.reporter_token_hash ?? null,
      previousStatus: report.status,
      newStatus: storedStatus,
      actor: input.actor,
    });
  }

  return { ok: true, previousStatus: report.status, storedStatus, changed };
}
