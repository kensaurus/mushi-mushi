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
import { dispatchPluginEventDetached } from './plugins.ts';

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
  },
): void {
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
  }
  if (input.reporterTokenHash) {
    notifyReportStatusTransition(db, {
      projectId: input.projectId,
      reportId: input.reportId,
      reporterTokenHash: input.reporterTokenHash,
      previousStatus: input.previousStatus,
      newStatus: input.newStatus,
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
