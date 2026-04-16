import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'

const notifLog = log.child('notifications')

export type NotificationType = 'classified' | 'confirmed' | 'fixed' | 'dismissed' | 'points_awarded'

interface NotificationPayload {
  message: string
  category?: string
  severity?: string
  points?: number
  reportId: string
}

export async function createNotification(
  db: SupabaseClient,
  projectId: string,
  reportId: string,
  reporterTokenHash: string,
  type: NotificationType,
  payload: NotificationPayload,
): Promise<void> {
  const { error } = await db.from('reporter_notifications').insert({
    project_id: projectId,
    report_id: reportId,
    reporter_token_hash: reporterTokenHash,
    notification_type: type,
    channel: 'in_app',
    payload,
    sent_at: new Date().toISOString(),
  })

  if (error) {
    notifLog.error('Insert failed', { type, error: error.message })
  }
}

export function buildNotificationMessage(type: NotificationType, context: {
  category?: string
  severity?: string
  points?: number
}): string {
  switch (type) {
    case 'classified':
      return `Your report was classified as ${context.category ?? 'unknown'}/${context.severity ?? 'unset'}`
    case 'confirmed':
      return `Your bug report was confirmed! +${context.points ?? 50} points`
    case 'fixed':
      return `The bug you reported has been fixed! +${context.points ?? 25} points`
    case 'dismissed':
      return `Your report was reviewed and closed`
    case 'points_awarded':
      return `You earned ${context.points ?? 0} points!`
    default:
      return 'Your report has been updated'
  }
}
