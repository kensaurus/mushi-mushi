/**
 * FILE: report-status-notify.ts
 * PURPOSE: Single entry point for reporter-facing notifications on admin/fix-worker status transitions.
 *
 * OVERVIEW:
 * - Gates on project_settings.reporter_notifications_enabled (default true).
 * - Idempotent via createNotification's delivery ledger.
 * - Used by admin PATCH, fix-worker, and finalizeFixMerge so paths never diverge.
 * - Pipeline messages (fix started, fixed, closed) are `reviewable`: a project
 *   in review mode holds them in the console Outbox (Plan 018 decision 7).
 *   Reporters following the report (theirs was a duplicate) get a copy.
 * - closed_reason 'spam' closes silently: no message at all.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { awardPoints } from './reputation.ts';
import {
  createNotification,
  buildNotificationMessage,
  notifyFollowers,
  type NotificationPayload,
  type NotificationType,
} from './notifications.ts';
import { isReporterFixedStatus, toStoredStatus } from './report-status.ts';
import { log } from './logger.ts';

const notifyLog = log.child('report-status-notify');

async function reporterNotificationsEnabled(
  db: SupabaseClient,
  projectId: string,
): Promise<boolean> {
  const { data } = await db
    .from('project_settings')
    .select('reporter_notifications_enabled')
    .eq('project_id', projectId)
    .maybeSingle();
  // Column defaults to true; only skip when explicitly false.
  return (data as { reporter_notifications_enabled?: boolean } | null)
    ?.reporter_notifications_enabled !== false;
}

export interface ReportStatusTransitionNotifyInput {
  projectId: string;
  reportId: string;
  reporterTokenHash: string | null | undefined;
  previousStatus: string | null | undefined;
  newStatus: string;
  /** For `dismissed`: why it was closed (shown to the reporter; 'spam' sends nothing). */
  closedReason?: string | null;
}

/**
 * Owner first, then every follower of the report. Followers earned no points
 * on this report, so their copy drops `points` and the owner's
 * "confirmed, +50 points" becomes a plain `fix_started`.
 */
async function notifyOwnerAndFollowers(
  db: SupabaseClient,
  input: ReportStatusTransitionNotifyInput & { reporterTokenHash: string },
  type: NotificationType,
  payload: NotificationPayload,
  reviewable: boolean,
): Promise<void> {
  await createNotification(db, input.projectId, input.reportId, input.reporterTokenHash, type, payload, { reviewable });
  const followerType: NotificationType = type === 'confirmed' ? 'fix_started' : type;
  const { points: _points, ...followerPayload } = payload;
  await notifyFollowers(
    db,
    input.projectId,
    input.reportId,
    followerType,
    { ...followerPayload, message: buildNotificationMessage(followerType, {}) },
    { reviewable },
  );
}

/** The canonical report a duplicate was grouped under, or null. */
async function canonicalReportFor(db: SupabaseClient, reportId: string): Promise<string | null> {
  const { data: report, error } = await db
    .from('reports')
    .select('report_group_id')
    .eq('id', reportId)
    .maybeSingle();
  const groupId = (report as { report_group_id?: string | null } | null)?.report_group_id;
  if (error || !groupId) return null;
  const { data: group } = await db
    .from('report_groups')
    .select('canonical_report_id')
    .eq('id', groupId)
    .maybeSingle();
  const canonical = (group as { canonical_report_id?: string | null } | null)?.canonical_report_id ?? null;
  return canonical && canonical !== reportId ? canonical : null;
}

async function notifyDuplicateClose(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
  reporterTokenHash: string,
): Promise<void> {
  const canonical = await canonicalReportFor(db, reportId);
  if (!canonical) {
    // The close route requires a group; without one there is nothing to follow.
    notifyLog.warn('duplicate_close_without_canonical', { reportId });
    return;
  }
  await createNotification(
    db,
    projectId,
    reportId,
    reporterTokenHash,
    'duplicate_linked',
    { message: buildNotificationMessage('duplicate_linked', {}), reportId, canonicalReportId: canonical },
    { dedupeKey: canonical },
  );
}

/**
 * Notify the reporter (in-app / email per prefs) when a report's status changes.
 * No-op when notifications are disabled, token hash is missing, or status unchanged.
 */
export async function notifyReportStatusTransition(
  db: SupabaseClient,
  input: ReportStatusTransitionNotifyInput,
): Promise<void> {
  const { projectId, reportId, reporterTokenHash } = input;
  if (!reporterTokenHash) return;
  const owner = { ...input, reporterTokenHash };

  const previousStatus = toStoredStatus(input.previousStatus) ?? input.previousStatus ?? null;
  const newStatus = toStoredStatus(input.newStatus) ?? input.newStatus;
  if (!newStatus || newStatus === previousStatus) return;

  if (!(await reporterNotificationsEnabled(db, projectId))) return;

  try {
    if (newStatus === 'fixing' && previousStatus !== 'fixing') {
      await awardPoints(db, projectId, reporterTokenHash, { action: 'confirmed' }).catch((e) =>
        notifyLog.warn('Reputation award failed', { action: 'confirmed', err: String(e) }),
      );
      await notifyOwnerAndFollowers(db, owner, 'confirmed', {
        message: buildNotificationMessage('confirmed', { points: 50 }),
        points: 50,
        reportId,
      }, true);
      return;
    }

    if (isReporterFixedStatus(newStatus) && !isReporterFixedStatus(previousStatus ?? '')) {
      await awardPoints(db, projectId, reporterTokenHash, { action: 'fixed' }).catch((e) =>
        notifyLog.warn('Reputation award failed', { action: 'fixed', err: String(e) }),
      );
      await notifyOwnerAndFollowers(db, owner, 'fixed', {
        message: buildNotificationMessage('fixed', { points: 25 }),
        points: 25,
        reportId,
      }, true);
      return;
    }

    if (newStatus === 'verified' && previousStatus !== 'verified') {
      await createNotification(db, projectId, reportId, reporterTokenHash, 'verified', {
        message: buildNotificationMessage('verified', {}),
        reportId,
      });
      return;
    }

    if (newStatus === 'reopened' && previousStatus !== 'reopened') {
      await createNotification(db, projectId, reportId, reporterTokenHash, 'reopened', {
        message: buildNotificationMessage('reopened', {}),
        reportId,
      });
      return;
    }

    if (newStatus === 'dismissed' && previousStatus !== 'dismissed') {
      if (input.closedReason === 'spam') return;
      await awardPoints(db, projectId, reporterTokenHash, { action: 'dismissed' }).catch((e) =>
        notifyLog.warn('Reputation award failed', { action: 'dismissed', err: String(e) }),
      );
      // A duplicate close sends exactly ONE notice: `duplicate_linked`, keyed
      // by the canonical report id — the same key the reports_follow_canonical
      // trigger writes. When the trigger already wrote it (at grouping or at
      // this close) the unique index makes this a no-op; when the trigger's
      // insert failed (it swallows errors so grouping survives), this is the
      // notice. A 'dismissed' message on top would be the second notice.
      if (input.closedReason === 'duplicate') {
        await notifyDuplicateClose(db, projectId, reportId, reporterTokenHash);
        return;
      }
      await notifyOwnerAndFollowers(db, owner, 'dismissed', {
        message: buildNotificationMessage('dismissed', {}),
        reportId,
        closedReason: input.closedReason ?? null,
      }, true);
    }
  } catch (e) {
    notifyLog.warn('notifyReportStatusTransition failed', {
      reportId,
      newStatus,
      err: String(e),
    });
  }
}
