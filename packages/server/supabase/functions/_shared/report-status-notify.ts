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

/** Owner first, then every follower of the report. */
async function notifyOwnerAndFollowers(
  db: SupabaseClient,
  input: ReportStatusTransitionNotifyInput & { reporterTokenHash: string },
  type: NotificationType,
  payload: NotificationPayload,
  reviewable: boolean,
): Promise<void> {
  await createNotification(db, input.projectId, input.reportId, input.reporterTokenHash, type, payload, { reviewable });
  await notifyFollowers(db, input.projectId, input.reportId, type, payload, { reviewable });
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
      const payload = {
        message: buildNotificationMessage('dismissed', {}),
        reportId,
        closedReason: input.closedReason ?? null,
      };
      // A duplicate close tells only its own reporter (the trigger's
      // duplicate_linked notice carries the follow); any other close of a
      // canonical report reaches its followers too.
      if (input.closedReason === 'duplicate') {
        await createNotification(db, projectId, reportId, reporterTokenHash, 'dismissed', payload, { reviewable: true });
      } else {
        await notifyOwnerAndFollowers(db, owner, 'dismissed', payload, true);
      }
    }
  } catch (e) {
    notifyLog.warn('notifyReportStatusTransition failed', {
      reportId,
      newStatus,
      err: String(e),
    });
  }
}
