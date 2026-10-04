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
  /** Reports whose last auto-fix stopped (counted per report). */
  fixesFailed: number
  integrationIssues: number
  /** Names of the integrations whose last health check was not ok. */
  failingIntegrations?: Array<{ kind: string; label: string }>
  reports14d: number
}

export type InsightTone = 'ok' | 'warn' | 'danger'

export interface DashboardInsight {
  tone: InsightTone
  sentence: string
  /** Every problem carries its fix: where to go to clear it. */
  action?: { label: string; to: string }
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

function namedList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export function deriveDashboardInsight(s: DashboardInsightInput): DashboardInsight {
  // Most-critical issue wins; fallback to healthy.
  const stoppedAction = { label: 'See why it stopped', to: '/fixes?tab=attempts&status=failed' }
  if (s.fixesFailed > 0 && s.openBacklog > 0) {
    return {
      tone: 'danger',
      sentence: `Auto-fix stopped on ${s.fixesFailed} ${plural(s.fixesFailed, 'report', 'reports')} and ${s.openBacklog} ${plural(s.openBacklog, 'report is', 'reports are')} waiting to triage — the loop is stalled at two points.`,
      action: stoppedAction,
    }
  }
  if (s.fixesFailed > 0) {
    return {
      tone: 'danger',
      sentence: `Auto-fix stopped on ${s.fixesFailed} ${plural(s.fixesFailed, 'report', 'reports')}${s.fixesInProgress > 0 ? ` (${s.fixesInProgress} more in progress)` : ''}. Read why the last attempt stopped, then retry or close.`,
      action: stoppedAction,
    }
  }
  if (s.openBacklog > 5) {
    return {
      tone: 'warn',
      sentence: `${s.openBacklog} reports in the triage backlog — growing queue. Work top-severity items before new bugs pile up.`,
      action: { label: 'Triage the backlog', to: '/reports?status=new' },
    }
  }
  if (s.openBacklog > 0) {
    return {
      tone: 'warn',
      sentence: `${s.openBacklog} ${plural(s.openBacklog, 'report', 'reports')} waiting to triage${s.fixesInProgress > 0 ? ` · ${s.fixesInProgress} ${plural(s.fixesInProgress, 'fix', 'fixes')} in progress` : ''}.`,
      action: { label: 'Triage now', to: '/reports?status=new' },
    }
  }
  if (s.integrationIssues > 0) {
    const named = (s.failingIntegrations ?? []).map((i) => i.label)
    const first = s.failingIntegrations?.[0]
    const who = named.length > 0 ? namedList(named) : `${s.integrationIssues} ${plural(s.integrationIssues, 'integration', 'integrations')}`
    const verb = named.length === 1 || (named.length === 0 && s.integrationIssues === 1) ? 'needs' : 'need'
    return {
      tone: 'warn',
      sentence: `${who} ${verb} attention — its last health check failed, so notifications or CI may be degraded.`,
      action: {
        label: named.length === 1 ? `Fix ${named[0]}` : 'Open integrations',
        to: first ? `/integrations/config#${encodeURIComponent(first.kind)}` : '/integrations/config',
      },
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
    // Scoped to triage on purpose: openBacklog counts untriaged reports only,
    // so triaged reports still awaiting a fix can exist here.
    sentence: `Nothing waiting to triage${s.reports14d > 0 ? ` — ${s.reports14d} report${s.reports14d === 1 ? '' : 's'} received in the last 14 days` : ''}.`,
  }
}

/**
 * Advanced mode shows the live PDCA canvas once the full dashboard renders
 * and there are stages to draw; the first-report hero replaces it for a
 * project with no reports yet. The insight banner is NOT a condition: it is
 * one line above the canvas, and gating on it hid the canvas for good (QA 169).
 */
export function shouldShowPdcaFlow(input: {
  isAdvanced: boolean
  renderFullDashboard: boolean
  hasPdcaStages: boolean
  showFirstReportHero: boolean
}): boolean {
  return input.isAdvanced && input.renderFullDashboard && input.hasPdcaStages && !input.showFirstReportHero
}
