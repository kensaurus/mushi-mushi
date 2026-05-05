import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'

const auditLog = log.child('audit')

export type AuditAction = 'report.created' | 'report.classified' | 'report.triaged' | 'report.fixed'
  | 'api_key.created' | 'api_key.revoked' | 'settings.updated'
  | 'user.logged_in' | 'user.logged_out'
  | 'fix.attempted' | 'fix.reviewed'
  | 'integration.synced' | 'plugin.executed'
  | 'billing.checkout_started' | 'billing.subscription_changed' | 'billing.payment_failed'
  | 'support.ticket_created' | 'support.ticket_status_changed'
  | 'compliance.retention.updated'
  | 'compliance.dsar.created' | 'compliance.dsar.updated'
  | 'compliance.soc2.evidence_refreshed'
  // v2 inventory + gates audit actions (whitepaper §4.1, §5)
  | 'inventory.ingest' | 'inventory.reconcile' | 'inventory.gates_run'
  | 'inventory.test_gen' | 'inventory.status_changed'

export async function logAudit(
  db: SupabaseClient,
  projectId: string,
  actorId: string,
  action: AuditAction,
  resourceType: string,
  resourceId?: string,
  metadata?: Record<string, unknown>,
  context?: { email?: string; actorType?: string; ip?: string; userAgent?: string },
): Promise<void> {
  await db.from('audit_logs').insert({
    project_id: projectId,
    actor_id: actorId,
    actor_email: context?.email,
    actor_type: context?.actorType ?? 'user',
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    metadata,
    ip_address: context?.ip,
    user_agent: context?.userAgent,
  }).then(({ error }) => {
    if (error) auditLog.error('Insert failed', { action, error: error.message })
  })
}
