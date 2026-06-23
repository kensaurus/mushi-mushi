/**
 * FILE: report-status-notify.ts
 * PURPOSE: Single entry point for reporter-facing notifications on admin/fix-worker status transitions.
 *
 * OVERVIEW:
 * - Gates on project_settings.reporter_notifications_enabled (default true).
 * - Idempotent via createNotification's delivery ledger.
 * - Used by admin PATCH, fix-worker, and finalizeFixMerge so paths never diverge.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { awardPoints } from './reputation.ts';
import { createNotification, buildNotificationMessage } from './notifications.ts';
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

  const previousStatus = toStoredStatus(input.previousStatus) ?? input.previousStatus ?? null;
  const newStatus = toStoredStatus(input.newStatus) ?? input.newStatus;
  if (!newStatus || newStatus === previousStatus) return;

  if (!(await reporterNotificationsEnabled(db, projectId))) return;

  try {
    if (newStatus === 'fixing' && previousStatus !== 'fixing') {
      await awardPoints(db, projectId, reporterTokenHash, { action: 'confirmed' }).catch((e) =>
        notifyLog.warn('Reputation award failed', { action: 'confirmed', err: String(e) }),
      );
      await createNotification(db, projectId, reportId, reporterTokenHash, 'confirmed', {
        message: buildNotificationMessage('confirmed', { points: 50 }),
        points: 50,
        reportId,
      });
      return;
    }

    if (isReporterFixedStatus(newStatus) && !isReporterFixedStatus(previousStatus ?? '')) {
      await awardPoints(db, projectId, reporterTokenHash, { action: 'fixed' }).catch((e) =>
        notifyLog.warn('Reputation award failed', { action: 'fixed', err: String(e) }),
      );
      await createNotification(db, projectId, reportId, reporterTokenHash, 'fixed', {
        message: buildNotificationMessage('fixed', { points: 25 }),
        points: 25,
        reportId,
      });
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
      await awardPoints(db, projectId, reporterTokenHash, { action: 'dismissed' }).catch((e) =>
        notifyLog.warn('Reputation award failed', { action: 'dismissed', err: String(e) }),
      );
      await createNotification(db, projectId, reportId, reporterTokenHash, 'dismissed', {
        message: buildNotificationMessage('dismissed', {}),
        reportId,
      });
    }
  } catch (e) {
    notifyLog.warn('notifyReportStatusTransition failed', {
      reportId,
      newStatus,
      err: String(e),
    });
  }
}
