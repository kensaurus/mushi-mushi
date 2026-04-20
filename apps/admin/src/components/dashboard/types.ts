/**
 * FILE: apps/admin/src/components/dashboard/types.ts
 * PURPOSE: Shared shapes for the dashboard payload + small relTime helper.
 *          Extracted so each dashboard subcomponent can pull only what it
 *          needs without depending on the page itself.
 */

export interface ReportDay {
  day: string
  total: number
  critical: number
  high: number
  medium: number
  low: number
  unscored: number
}

export interface LlmDay {
  day: string
  calls: number
  tokens: number
  latencyMs: number
  failures: number
}

export interface FixSummary {
  total: number
  completed: number
  failed: number
  inProgress: number
  openPrs: number
}

export interface IntegrationStatus {
  kind: string
  lastStatus: string | null
  lastAt: string | null
  uptime: number | null
}

export interface ActivityItem {
  kind: 'report' | 'fix'
  id: string
  label: string
  meta: string | null
  at: string
}

export interface TriageItem {
  id: string
  summary: string
  severity: string | null
  category: string | null
  status: string | null
  created_at: string
}

export interface DashboardCounts {
  reports14d: number
  openBacklog: number
  fixesTotal: number
  openPrs: number
  llmCalls14d: number
  llmTokens14d: number
  llmFailures14d: number
}

import type { PdcaStageId } from '../../lib/pdca'
export type { PdcaStageId }
export type PdcaStageTone = 'ok' | 'warn' | 'urgent'

export interface PdcaStage {
  id: PdcaStageId
  label: string
  icon: string
  description: string
  count: number
  countLabel: string
  bottleneck: string | null
  tone: PdcaStageTone
  cta: { to: string; label: string }
}

export interface DashboardData {
  empty: boolean
  projects?: Array<{ id: string; name: string }>
  window?: { days: string[]; since: string }
  counts?: DashboardCounts
  reportsByDay?: ReportDay[]
  llmByDay?: LlmDay[]
  fixSummary?: FixSummary
  topComponents?: Array<{ component: string; count: number }>
  triageQueue?: TriageItem[]
  activity?: ActivityItem[]
  integrations?: IntegrationStatus[]
  pdcaStages?: PdcaStage[]
  focusStage?: PdcaStageId | null
}

export function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}
