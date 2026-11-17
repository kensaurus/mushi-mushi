/**
 * FILE: apps/admin/src/lib/opsTypes.ts
 * PURPOSE: What the Ops hub routes answer (packages/server/supabase/functions/api/routes/ops.ts).
 */

export type OpsCategory = 'payments' | 'releases' | 'alerts'
export type OpsSeverity = 'info' | 'warn' | 'urgent' | 'resolved'

export interface OpsEvent {
  id: string
  organization_id: string
  project_id: string | null
  category: OpsCategory
  severity: OpsSeverity
  kind: string
  title: string
  body: string | null
  facts: Array<{ label: string; value: string }>
  url: string | null
  amount_minor: number | null
  currency: string | null
  thread_key: string | null
  parent_id: string | null
  occurred_at: string
  source: 'app' | 'github' | 'sentry' | 'uptime' | 'mushi'
  slack_channel: string | null
  slack_ts: string | null
  slack_error: string | null
  acked_by: string | null
  acked_at: string | null
}

export interface OpsApp {
  id: string
  name: string | null
  slug: string | null
  icon_url: string | null
}

export interface OpsFeedResponse {
  events: OpsEvent[]
  apps: OpsApp[]
  nextBefore: string | null
  canAck: boolean
}

export interface OpsCoverageRow {
  project_id: string
  category: OpsCategory | 'bugs'
  last_at: string | null
  count_7d: number
}

export interface OpsCoverageResponse {
  apps: OpsApp[]
  coverage: OpsCoverageRow[]
  today: { payments: Record<string, number>; releases: number; openAlerts: number; since: string }
  mutes: Array<{ project_id: string; until: string }>
  slack: { enabled: boolean }
}

export interface OpsSlackSettings {
  enabled: boolean
  teamId: string | null
  botUserId: string | null
  botToken: boolean
  signingSecret: boolean
  webhooks: Record<OpsCategory, boolean>
  channels: Record<OpsCategory, string | null>
  command: string
  iconBaseUrl: string | null
  updatedAt: string | null
  requestUrls: { commands: string; interactions: string } | null
  canEdit: boolean
}

export interface OpsKeyMinted {
  id: string | null
  key: string
  prefix: string
  scopes: string[]
  label: string
}
