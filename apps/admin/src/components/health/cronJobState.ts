/**
 * FILE: apps/admin/src/components/health/cronJobState.ts
 * PURPOSE: One status for a scheduled job, from its last run AND its schedule (round 3,
 *          2026-11-19): intelligence-report showed a green "success" pill while Overview said it
 *          was overdue, and every job read "0 runs · 100% success · avg 0ms". The pill, the
 *          overdue card, the "Jobs on time" figure and the row's line all read this.
 *
 *          `runs` counts the jobs in the server's newest-100 window only, and a job outside that
 *          window comes back seeded with `successRate: 1`. So with runs = 0 the line names the last
 *          run and no rate: "100%" over zero runs is not a measurement.
 */

import type { SignalTone } from '../signal/StatusGlyph'

interface CronJobLike {
  lastRun: string | null
  lastStatus: string | null
  successRate: number
  avgDurationMs: number
  runs: number
  stalenessMinutes?: number | null
  staleness?: 'ok' | 'warn' | 'stale' | 'never'
}

interface CronJobState {
  tone: Extract<SignalTone, 'ok' | 'warn' | 'danger' | 'off'>
  /** The pill: "on time", "overdue 9d", "failed", "never run". */
  label: string
  /** Late against its schedule (warn or stale), and not failed. */
  overdue: boolean
  failed: boolean
  /** The line under the name, e.g. "Last ran 9d ago" or "12 runs · 92% succeeded · avg 340 ms". */
  detail: string
}

/** Minutes as one short unit: "45m", "5h", "9d".
 * @internal Exported for tests.
 */
export function shortAge(minutes: number): string {
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))}m`
  if (minutes < 60 * 48) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / (60 * 24))}d`
}

function ageSince(iso: string, now: number): number {
  return Math.max(0, (now - new Date(iso).getTime()) / 60_000)
}

export function cronJobState(j: CronJobLike | null | undefined, now = Date.now()): CronJobState {
  if (!j || !j.lastRun) {
    return { tone: 'off', label: 'never run', overdue: false, failed: false, detail: 'No run recorded yet.' }
  }
  const age = j.stalenessMinutes ?? ageSince(j.lastRun, now)
  const lastRan = `Last ran ${shortAge(age)} ago`
  const rate =
    j.runs > 0
      ? ` · ${j.runs} ${j.runs === 1 ? 'run' : 'runs'} · ${Math.round(j.successRate * 100)}% succeeded${j.avgDurationMs > 0 ? ` · avg ${j.avgDurationMs} ms` : ''}`
      : ''
  const detail = `${lastRan}${rate}`
  if (j.lastStatus === 'error') return { tone: 'danger', label: 'failed', overdue: false, failed: true, detail }
  if (j.staleness === 'warn' || j.staleness === 'stale') {
    return { tone: 'warn', label: `overdue ${shortAge(age)}`, overdue: true, failed: false, detail }
  }
  if (j.lastStatus === 'success') return { tone: 'ok', label: 'on time', overdue: false, failed: false, detail }
  return { tone: 'off', label: j.lastStatus ?? 'never run', overdue: false, failed: false, detail }
}
