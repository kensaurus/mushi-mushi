/**
 * FILE: apps/admin/src/lib/creditsView.ts
 * PURPOSE: Pure view rules for /credits (round-2 review 2026-11-18):
 *          - the real blocker (local workers offline while credits expire)
 *            leads the page in red; "spend-down is off" is a config nudge in
 *            amber, never red;
 *          - an expiry countdown is a warning (amber), not a failure;
 *          - an expired Cursor key has no live switch; a key no app uses
 *            reads as an amber "Unused" pill, not a sentence;
 *          - Firecrawl apps are one status table, worst first, with the last
 *            audit drawn as a pill ("4 failing" red, "Passed" green only when
 *            a run passed, hollow when never run).
 */

import type { RunStatus } from '../components/signal/StatusMark'
import type { CreditCountdown } from './creditPlan'
import type { WorkLanesData } from './workers'

type Tone = CreditCountdown['tone']

/**
 * A countdown card's colour. Out of credits (Cursor refused the runs) stays
 * red: that is a failure. Few days left with spend-down off is a nudge: amber.
 */
export function countdownDisplayTone(card: Pick<CreditCountdown, 'tone' | 'idle'>): Tone {
  return card.idle && card.tone === 'danger' ? 'warn' : card.tone
}

/** The countdown status row: red only when the agents are out of credits; idle keys amber. */
export function countdownStatusTone(out: boolean, idleCount: number): 'danger' | 'warn' | 'ok' {
  if (out) return 'danger'
  return idleCount > 0 ? 'warn' : 'ok'
}

export interface CreditsBlocker {
  severity: 'critical' | 'serious'
  title: string
  cause: string
  /** Lanes on machines that are offline. */
  offlineLanes: number
  offlineHosts: string[]
  /** Whole hours since a local agent last worked, when the flag knows. */
  idleHours: number | null
}

/**
 * The page-level blocker: the worker flag `credits_idle` (no local agent has
 * worked while Cursor credits expire; ADR 0048). The out-of-credits flag
 * (`credits_out`) has its own card at the top already. Null without the flag.
 */
export function creditsBlocker(data: WorkLanesData | null | undefined): CreditsBlocker | null {
  if (!data || !Array.isArray(data.lanes)) return null
  const flag = (data.flags ?? []).find((f) => f.kind === 'credits_idle' && f.id !== 'credits_out')
  if (!flag) return null
  const hosts = new Map((data.hosts ?? []).map((h) => [h.id, h]))
  const offline = data.lanes.filter((l) => !hosts.get(l.hostId)?.online)
  const offlineHosts = [...new Set(offline.map((l) => hosts.get(l.hostId)?.hostname ?? 'unknown machine'))]
  return {
    severity: flag.severity === 'danger' ? 'critical' : 'serious',
    title: flag.title,
    cause: flag.cause,
    offlineLanes: offline.length,
    offlineHosts,
    idleHours: flag.sinceSec != null && flag.sinceSec >= 0 ? Math.round(flag.sinceSec / 3600) : null,
  }
}

/** The spend-down key states the switch row needs. */
interface KeyLike {
  state: 'off' | 'expired' | 'key_unusable' | 'not_started' | 'active'
  enabled: boolean
  creditsExpireAt: string | null
  projects: ReadonlyArray<unknown>
  otherApps?: number
  idleNote?: string | null
}

/** Expired credits cannot be spent: the switch is not offered as live. */
export function spendDownSwitchLocked(k: Pick<KeyLike, 'state' | 'enabled' | 'creditsExpireAt'>): boolean {
  return k.state === 'expired' || (!k.enabled && !k.creditsExpireAt)
}

/** On, and no app sends bugs through it: the amber "Unused" pill. */
export function spendDownUnused(k: Pick<KeyLike, 'state' | 'projects' | 'otherApps' | 'idleNote'>): boolean {
  return k.state === 'active' && k.projects.length === 0 && (k.otherApps ?? 0) === 0 && !k.idleNote
}

export interface AuditLike {
  enabled: boolean
  batch_id: string | null
  next_run_at: string | null
  last_run_at: string | null
  last_error: string | null
}

/** The last audit as a pill. "Passed" only for a run that finished with every rule passing. */
export function auditRunStatus(audit: AuditLike | null, openFindings: number, now = Date.now()): { status: RunStatus; label: string } {
  if (!audit) return { status: 'idle', label: 'No audit' }
  if (audit.batch_id) return { status: 'running', label: 'Running' }
  if (audit.enabled && audit.next_run_at && Date.parse(audit.next_run_at) <= now) return { status: 'waiting', label: 'Starting' }
  if (audit.last_error) return { status: 'failed', label: 'Error' }
  if (!audit.last_run_at) return { status: 'idle', label: 'Not run yet' }
  if (openFindings > 0) return { status: 'failed', label: `${openFindings} failing` }
  return { status: 'passed', label: 'Passed' }
}

/** How bad an app's row is, for sorting worst first. */
function badness(a: { audit: AuditLike | null; auditFindings: number; error?: string }): number {
  if (a.error) return 1000
  const s = auditRunStatus(a.audit, a.auditFindings)
  if (s.status === 'failed') return 100 + a.auditFindings
  if (s.status === 'waiting' || s.status === 'running') return 10
  return 0
}

/** Apps worst first (an error, then the most failing rules); ties keep their order. */
export function appsWorstFirst<T extends { audit: AuditLike | null; auditFindings: number; error?: string }>(apps: readonly T[]): T[] {
  return apps
    .map((a, i) => ({ a, i, b: badness(a) }))
    .sort((x, y) => y.b - x.b || x.i - y.i)
    .map((x) => x.a)
}

/** "Daily · 100 pages" for the watch column; null when the watch is off. */
export function watchSummary(watch: { page_limit: number } | null): string | null {
  return watch ? `Daily · ${watch.page_limit} pages` : null
}

/** "Weekly · 200 pages" for the audit column; null when the audit is off. */
export function auditScheduleSummary(audit: { enabled: boolean; cadence_days: number; page_limit: number } | null): string | null {
  if (!audit?.enabled) return null
  const cadence = audit.cadence_days === 1 ? 'Daily' : audit.cadence_days === 7 ? 'Weekly' : `Every ${audit.cadence_days} days`
  return `${cadence} · ${audit.page_limit} pages`
}
