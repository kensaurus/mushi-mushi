/**
 * FILE: apps/admin/src/components/compliance/retentionChange.ts
 * PURPOSE: Plain-English consequence of shortening a retention window, shown
 *          in the confirm dialog before the change is saved.
 */

export type RetentionField =
  | 'reports_retention_days'
  | 'audit_retention_days'
  | 'llm_traces_retention_days'
  | 'byok_audit_retention_days'

export const RETENTION_FIELD_LABELS: Record<RetentionField, string> = {
  reports_retention_days: 'Reports',
  audit_retention_days: 'Audit log',
  llm_traces_retention_days: 'LLM traces',
  byok_audit_retention_days: 'BYOK audit',
}

export function describeRetentionChange(
  field: RetentionField,
  from: number,
  to: number,
  projectName: string,
  legalHold: boolean,
): string {
  const what = RETENTION_FIELD_LABELS[field].toLowerCase()
  const head = `${projectName} will keep ${what} for ${to} days instead of ${from}.`
  if (legalHold) {
    return `${head} The project is on legal hold, so nothing is deleted until the hold is lifted.`
  }
  return `${head} At the next nightly sweep, ${what} older than ${to} days can be permanently deleted. This cannot be undone.`
}

/** Column defaults of project_retention_policies (migration 20260418001300). */
export const NEW_POLICY_DEFAULTS = {
  audit_retention_days: 730,
  llm_traces_retention_days: 90,
  byok_audit_retention_days: 365,
} as const

/**
 * A project with no policy row keeps its audit and BYOK audit logs forever
 * (mushi_apply_retention only walks existing rows). Creating a row starts
 * those sweeps, so the confirm has to say so.
 */
export function describeNewPolicy(projectName: string, reportsDays: number): string {
  return (
    `${projectName} keeps reports for ${reportsDays} days, the same as today. ` +
    `A policy also starts deleting audit log entries older than ${NEW_POLICY_DEFAULTS.audit_retention_days} days ` +
    `and BYOK audit entries older than ${NEW_POLICY_DEFAULTS.byok_audit_retention_days} days at the nightly sweep; ` +
    'today those are kept indefinitely. You can change every window after the policy is created.'
  )
}
