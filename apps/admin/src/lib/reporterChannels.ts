/**
 * FILE: apps/admin/src/lib/reporterChannels.ts
 * PURPOSE: Plain-English labels and save logic for the "Email and push
 *          updates" card (Plan 018 Phase 3). Pure, so it is unit-tested.
 */

export type TemplateKey = 'reviewing' | 'fix_started' | 'fixed' | 'released' | 'closed' | 'duplicate_linked'

export const TEMPLATE_KEYS: readonly TemplateKey[] = ['reviewing', 'fix_started', 'fixed', 'released', 'closed', 'duplicate_linked']

export const TEMPLATE_LABEL: Record<TemplateKey, string> = {
  reviewing: 'Looking into it',
  fix_started: 'Fix in progress',
  fixed: 'Fixed',
  released: 'Shipped in a release',
  closed: 'Closed',
  duplicate_linked: 'Same as another report',
}

export const TEMPLATE_MAX = 280

export interface DeliveryCount {
  channel: 'email' | 'push'
  status: string
  reason: string | null
  count: number
}

export interface ReporterSettingsView {
  project_id: string
  mode: 'auto' | 'review'
  email_enabled: boolean
  push_enabled: boolean
  templates: Partial<Record<TemplateKey, string>>
  default_copy: Record<TemplateKey, string>
  providers: { email: 'configured' | 'not_configured'; push: 'configured' | 'not_configured' }
  subscribers: { email: number; push: number }
  deliveries_7d: DeliveryCount[]
}

const REASON_TEXT: Record<string, string> = {
  not_configured: 'Not set up on the server',
  push_not_configured: 'Not set up on the server',
  project_disabled: 'Turned off for this project',
  unverified: "Reporter hasn't confirmed their email yet",
  unsubscribed: 'Reporter unsubscribed',
  no_email: 'No email address',
  no_push_subscription: 'Reporter has no browser subscribed',
  capped: 'Over the daily limit — not sent',
  capped_daily: 'Over the daily limit — goes in the daily digest',
  capped_report: 'Already emailed about this report today — goes in the daily digest',
  digest: 'Sent in the daily digest',
  error: 'The send failed',
}

/** One ledger row group as a sentence: "Email · skipped · Not set up on the server". */
export function deliveryLabel(row: DeliveryCount): string {
  const channel = row.channel === 'email' ? 'Email' : 'Push'
  if (row.status === 'sent') return row.reason === 'digest' ? `${channel} · ${REASON_TEXT.digest}` : `${channel} · Sent`
  if (row.status === 'deferred') return `${channel} · ${REASON_TEXT[row.reason ?? ''] ?? 'Waiting for the daily digest'}`
  if (row.status === 'failed') return `${channel} · ${REASON_TEXT.error}`
  if (row.status === 'pending') return `${channel} · Sending`
  const reason = row.reason?.startsWith('digest_') ? row.reason.slice('digest_'.length) : row.reason
  return `${channel} · Not sent: ${REASON_TEXT[reason ?? ''] ?? reason ?? 'skipped'}`
}

/** True when the delivery group means something needs the developer's attention. */
export function deliveryNeedsAttention(row: DeliveryCount): boolean {
  return row.status === 'failed' || row.reason === 'not_configured' || row.reason === 'push_not_configured'
}

/** The `templates` body for PUT: every key, '' meaning "use the built-in wording". */
export function templatesPayload(drafts: Partial<Record<TemplateKey, string>>): Record<TemplateKey, string> {
  const out = {} as Record<TemplateKey, string>
  for (const key of TEMPLATE_KEYS) out[key] = (drafts[key] ?? '').trim()
  return out
}

/** Client-side check mirroring the server: known placeholders only, length cap. */
export function templateProblem(text: string): string | null {
  const t = text.trim()
  if (!t) return null
  if (t.length > TEMPLATE_MAX) return `Keep it under ${TEMPLATE_MAX} characters`
  for (const m of t.matchAll(/\{([^{}]*)\}/g)) {
    if (!['version', 'app', 'n'].includes(m[1])) return `{${m[1]}} is not available — use {version}, {app} or {n}`
  }
  return null
}
