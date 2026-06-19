/**
 * Dashboard PDCA explainer — reuses inbox stage copy for the four-loop hero.
 */

import { PDCA_STAGES, type PdcaStageId } from './pdca'

export const DASHBOARD_PDCA_EXPLAINER_SUMMARY =
  'The dashboard is your loop at a glance: Plan (triage bugs), Do (land fixes), Check (judge quality), Act (wire integrations). Work the highlighted stage first — or open Inbox for the full checklist.'

export function dashboardStagePlain(id: PdcaStageId): string {
  return PDCA_STAGES[id].hint
}

export function isDashboardGuideExpanded(): boolean {
  return false
}

// ---------------------------------------------------------------------------
// Plain-language insight derivation — condensed 1-2 sentence verdict.
// ---------------------------------------------------------------------------

export interface DashboardInsightInput {
  openBacklog: number
  fixesInProgress: number
  fixesFailed: number
  integrationIssues: number
  reports14d: number
}

export type InsightTone = 'ok' | 'warn' | 'danger'

export interface DashboardInsight {
  tone: InsightTone
  sentence: string
}

export function deriveDashboardInsight(s: DashboardInsightInput): DashboardInsight {
  // Most-critical issue wins; fallback to healthy.
  if (s.fixesFailed > 0 && s.openBacklog > 0) {
    return {
      tone: 'danger',
      sentence: `${s.fixesFailed} fix${s.fixesFailed === 1 ? '' : 'es'} failed and ${s.openBacklog} report${s.openBacklog === 1 ? '' : 's'} waiting to triage — the loop is stalled at two points.`,
    }
  }
  if (s.fixesFailed > 0) {
    return {
      tone: 'danger',
      sentence: `${s.fixesFailed} auto-fix${s.fixesFailed === 1 ? '' : 'es'} failed${s.fixesInProgress > 0 ? ` (${s.fixesInProgress} still in progress)` : ''}. Review the failure reason and re-trigger or close.`,
    }
  }
  if (s.openBacklog > 5) {
    return {
      tone: 'warn',
      sentence: `${s.openBacklog} reports in the triage backlog — growing queue. Work top-severity items before new bugs pile up.`,
    }
  }
  if (s.openBacklog > 0) {
    return {
      tone: 'warn',
      sentence: `${s.openBacklog} report${s.openBacklog === 1 ? '' : 's'} waiting to triage${s.fixesInProgress > 0 ? ` · ${s.fixesInProgress} fix${s.fixesInProgress === 1 ? '' : 'es'} in progress` : ''}.`,
    }
  }
  if (s.integrationIssues > 0) {
    return {
      tone: 'warn',
      sentence: `${s.integrationIssues} integration${s.integrationIssues === 1 ? ' needs' : 's need'} attention — notifications or CI may be degraded.`,
    }
  }
  if (s.fixesInProgress > 0) {
    return {
      tone: 'ok',
      sentence: `${s.fixesInProgress} fix${s.fixesInProgress === 1 ? '' : 'es'} in progress, backlog clear.${s.reports14d > 0 ? ` ${s.reports14d} report${s.reports14d === 1 ? '' : 's'} received in the last 14 days.` : ''}`,
    }
  }
  return {
    tone: 'ok',
    sentence: `Loop clear${s.reports14d > 0 ? ` — ${s.reports14d} report${s.reports14d === 1 ? '' : 's'} processed in the last 14 days` : ''}.`,
  }
}
