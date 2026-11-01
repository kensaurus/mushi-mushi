/**
 * FILE: apps/admin/src/components/settings/dataEgress.ts
 * PURPOSE: Types and wording for Settings → Security → "Data egress"
 *          (Plan 023, ADR 0034). Pure, so every sentence the card shows is
 *          tested in dataEgress.test.ts.
 *
 *          GET  /v1/admin/egress/status   → EgressStatus
 *          POST /v1/admin/egress/selftest → EgressSelftest (non-viewers)
 */

import { describeActionError } from '../../lib/actionError'

interface EgressDenial {
  host: string
  /** The function (or code path) that tried to reach the host. */
  caller: string
  /** UTC day, YYYY-MM-DD. */
  day: string
  count: number
  lastAt: string
}

interface EgressIntegration {
  id: string
  label: string
  /** Where it would send data, e.g. "api.anthropic.com". */
  destination: string
  enabled: boolean
  allowed: boolean
  note: string | null
}

export interface EgressStatus {
  localOnly: boolean
  allowlist: string[]
  denials: EgressDenial[]
  integrations: EgressIntegration[]
}

type EgressOutcome = 'blocked_by_mushi' | 'network_unreachable' | 'reachable'

export interface EgressSelftest {
  localOnly: boolean
  results: { host: string; outcome: EgressOutcome; ms: number }[]
  passed: boolean
}

export const EGRESS_OUTCOME_LABEL: Record<EgressOutcome, string> = {
  blocked_by_mushi: 'Refused by Mushi',
  network_unreachable: 'Refused by the network',
  reachable: 'Reachable',
}

/** The one sentence under the self-test results. */
export function selftestSentence(test: EgressSelftest): string {
  const open = test.results.filter((r) => r.outcome === 'reachable').map((r) => r.host)
  if (test.passed && open.length === 0) return 'Nothing left this stack: every test host was refused.'
  if (open.length > 0) return `These hosts were reachable: ${open.join(', ')}.`
  return 'The self-test did not pass. Run it again, and check the server logs if it keeps failing.'
}

interface DenialRow {
  host: string
  day: string
  count: number
  callers: string[]
  lastAt: string
}

/**
 * The server counts per host, caller and day; the table shows host and day,
 * with the callers listed. Newest day first, then the most refused host.
 */
export function denialRows(denials: EgressDenial[]): DenialRow[] {
  const byKey = new Map<string, DenialRow>()
  for (const d of denials) {
    const key = `${d.day}\u0000${d.host}`
    const row = byKey.get(key)
    if (!row) {
      byKey.set(key, { host: d.host, day: d.day, count: d.count, callers: d.caller ? [d.caller] : [], lastAt: d.lastAt })
      continue
    }
    row.count += d.count
    if (d.caller && !row.callers.includes(d.caller)) row.callers.push(d.caller)
    if (d.lastAt > row.lastAt) row.lastAt = d.lastAt
  }
  return [...byKey.values()]
    .map((row) => ({ ...row, callers: [...row.callers].sort() }))
    .sort((a, b) => (a.day === b.day ? b.count - a.count || a.host.localeCompare(b.host) : a.day < b.day ? 1 : -1))
}

/** How an integration row reads: what happens to its traffic right now. */
export function integrationVerdict(row: EgressIntegration, localOnly: boolean): {
  label: string
  tone: 'ok' | 'warn' | 'neutral'
} {
  if (!row.enabled) return { label: 'Off', tone: 'neutral' }
  if (!localOnly) return { label: 'Sends data', tone: 'warn' }
  return row.allowed ? { label: 'Allowed', tone: 'warn' } : { label: 'Refused', tone: 'ok' }
}

type ApiError = { code?: string | null; message?: string | null } | null | undefined

function httpStatus(error: ApiError): number | null {
  const m = /^(\d{3}):/.exec(error?.message ?? '')
  return m ? Number(m[1]) : null
}

/** A failed status read or self-test, in one sentence. */
export function egressErrorText(error: ApiError, action: 'status' | 'selftest'): string {
  const code = (error?.code ?? '').toUpperCase()
  const status = httpStatus(error)
  if (code === 'FORBIDDEN' || status === 403) {
    return action === 'selftest'
      ? 'Viewers can see this card but cannot run the self-test. Ask a project owner or admin.'
      : 'Your role on this project cannot see where its data goes. Ask a project owner or admin.'
  }
  if (code === 'RATE_LIMITED' || status === 429) {
    return 'The self-test ran a moment ago. Wait a minute, then run it again.'
  }
  if (code === 'NOT_FOUND' || status === 404) {
    return 'This server does not have the data egress check yet. Update the server to use it.'
  }
  if ((status !== null && status >= 500) || code === 'INTERNAL' || code === 'INTERNAL_ERROR') {
    return action === 'selftest'
      ? 'The server could not run the self-test. Try again; if it keeps failing, check the api function logs.'
      : 'The server could not read the egress status. Try again; if it keeps failing, check the api function logs.'
  }
  return describeActionError(
    error,
    action === 'selftest' ? 'The self-test could not run.' : 'Could not load the egress status.',
  )
}
