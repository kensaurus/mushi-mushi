/**
 * FILE: apps/admin/src/lib/doctorView.ts
 * PURPOSE: How the console shows a server doctor line (GET /v1/admin/doctor,
 *          api/routes/doctor.ts): a human title and the app's name instead of
 *          `codebase_index:<uuid>`, problems first, and the one button that
 *          fixes each problem. Shared by the /health doctor card and the
 *          Settings self-host checklist.
 *
 * Statuses (server): pass = working, info = optional and not set up (never a
 * problem), warn = degraded, fail = broken.
 */

import type { RunStatus } from '../components/signal/StatusMark'

export type DoctorStatus = 'pass' | 'info' | 'warn' | 'fail'

export interface DoctorCheck {
  name: string
  status: DoctorStatus
  summary: string
  hint?: string
  label?: string
  fixHref?: string
  projectId?: string
  appName?: string | null
}

export interface DoctorReport {
  status: 'pass' | 'warn' | 'fail'
  checks: DoctorCheck[]
}

/** Colour + glyph for each status (StatusMark): fail ✕ red, warn orange, info hollow grey, pass ✓ green. */
export const DOCTOR_RUN_STATUS: Record<DoctorStatus, RunStatus> = {
  fail: 'failed',
  warn: 'slow',
  info: 'idle',
  pass: 'passed',
}

const RANK: Record<DoctorStatus, number> = { fail: 0, warn: 1, info: 2, pass: 3 }

/** The check's id without a per-app suffix (`codebase_index:<uuid>` → `codebase_index`). */
export function doctorCheckId(name: string): string {
  const i = name.indexOf(':')
  return i === -1 ? name : name.slice(0, i)
}

/** The server's label, else the id in words. Never the raw uuid. */
export function doctorTitle(check: Pick<DoctorCheck, 'name' | 'label'>): string {
  if (check.label) return check.label
  const words = doctorCheckId(check.name).replace(/^platform_/, '').replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Worst first; within a status, platform secrets before the rest; stable otherwise. */
export function orderDoctorChecks(checks: DoctorCheck[]): DoctorCheck[] {
  const platform = (c: DoctorCheck) => (c.name.startsWith('platform_') ? 0 : 1)
  return checks
    .map((c, i) => ({ c, i }))
    .sort((a, b) => RANK[a.c.status] - RANK[b.c.status] || platform(a.c) - platform(b.c) || a.i - b.i)
    .map((x) => x.c)
}

/** Problems (fail, warn) lead; optional extras and passing checks are counted and collapsed. */
export function splitDoctorChecks(checks: DoctorCheck[]): { problems: DoctorCheck[]; optional: DoctorCheck[]; ok: DoctorCheck[] } {
  const ordered = orderDoctorChecks(checks)
  return {
    problems: ordered.filter((c) => c.status === 'fail' || c.status === 'warn'),
    optional: ordered.filter((c) => c.status === 'info'),
    ok: ordered.filter((c) => c.status === 'pass'),
  }
}

export type DoctorAction =
  | { kind: 'reindex'; projectId: string; label: string }
  | { kind: 'link'; to: string; label: string }

/** The one button that fixes a line in the console, or null when the fix is a server secret. */
export function doctorAction(check: DoctorCheck): DoctorAction | null {
  if (check.status === 'pass') return null
  const id = doctorCheckId(check.name)
  if (id === 'codebase_index' && check.projectId) return { kind: 'reindex', projectId: check.projectId, label: 'Re-index' }
  if (id === 'dead_letter') return { kind: 'link', to: '/queue', label: 'Open queue' }
  if (id === 'stranded_reports') return { kind: 'link', to: '/reports', label: 'Open reports' }
  // A console route only; a docs path or URL is not a button.
  if (check.fixHref?.startsWith('/')) return { kind: 'link', to: check.fixHref, label: 'Fix' }
  return null
}
