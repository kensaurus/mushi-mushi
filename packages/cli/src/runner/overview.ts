/**
 * FILE: packages/cli/src/runner/overview.ts
 * PURPOSE: Terminal view of GET /v1/admin/ci/overview (Plan 022, ADR 0033):
 *          machines, runners, queue and run times, test-machine vs code
 *          failures, and the top advice. Pure: data in, lines out.
 *
 *          Field names follow the CiOverview contract. Host and runner rows
 *          mirror database columns, so both camelCase and snake_case spellings
 *          are read (the console route may pass either through).
 */

import { oneLine } from '../command-helpers.js'

interface CiAdvice {
  id: string
  /** 'high' | 'medium' | 'low' (server _shared/ci-overview-types.ts). */
  severity: string
  title: string
  detail?: string | null
  evidence?: unknown
  fix?: string | null
}

/**
 * A tolerant copy of CiOverview in packages/server/supabase/functions/_shared/
 * ci-overview-types.ts (the source of truth): every field optional so an older
 * or newer server still renders.
 */
export interface CiOverview {
  generatedAt?: string
  refreshedAt?: string | null
  window?: { days?: number; from?: string } | number | null
  permissions?: { jobs?: 'ok' | 'missing' | 'unknown'; runners?: 'ok' | 'missing' | 'unknown' } | null
  hosts?: Array<Record<string, unknown>>
  runners?: Array<Record<string, unknown>>
  repos?: Array<Record<string, unknown>>
  jobs?: Array<Record<string, unknown>>
  stats?: {
    queueP50s?: number | null
    queueP95s?: number | null
    durationP50s?: number | null
    durationP95s?: number | null
    passRate?: number | null
    infraFailures?: number | null
    codeFailures?: number | null
    [key: string]: unknown
  } | null
  advice?: CiAdvice[]
}

type Row = Record<string, unknown>

/** The first defined value among the given keys (camelCase or snake_case). */
function field(row: Row | null | undefined, ...keys: string[]): unknown {
  if (!row) return undefined
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null) return row[k]
  }
  return undefined
}

function num(row: Row | null | undefined, ...keys: string[]): number | null {
  const v = field(row, ...keys)
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(row: Row | null | undefined, ...keys: string[]): string | null {
  const v = field(row, ...keys)
  return typeof v === 'string' && v ? v : null
}

/**
 * Seconds as "45 s", "8 min", "2.5 h".
 * @internal Exported for tests only.
 */
export function fmtSeconds(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return 'unknown'
  if (s < 90) return `${Math.round(s)} s`
  if (s < 90 * 60) return `${Math.round(s / 60)} min`
  return `${(s / 3600).toFixed(1)} h`
}

function fmtMb(mb: number | null): string {
  if (mb == null) return '?'
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}

/** "3 min ago" from an ISO time and now. */
function fmtAgo(iso: string | null, now: Date): string {
  if (!iso) return 'never'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'unknown'
  const s = Math.max(0, (now.getTime() - t) / 1000)
  if (s < 90) return 'just now'
  return `${fmtSeconds(s)} ago`
}

function windowDays(w: CiOverview['window']): number | null {
  if (typeof w === 'number') return w
  if (w && typeof w === 'object' && typeof w.days === 'number') return w.days
  return null
}

/** Per-runner memory and OOM numbers the host heartbeat reported, by runner name. */
function hostRunnerStats(hosts: Row[]): Map<string, Row> {
  const out = new Map<string, Row>()
  for (const h of hosts) {
    const runners = field(h, 'runners')
    if (!Array.isArray(runners)) continue
    for (const r of runners as Row[]) {
      const name = str(r, 'name')
      if (name) out.set(name, r)
    }
  }
  return out
}

function runnerState(r: Row): string {
  const status = str(r, 'status') ?? 'unknown'
  const busy = field(r, 'busy') === true
  if (status === 'online') return busy ? 'BUSY' : 'ONLINE'
  if (status === 'offline') return 'OFFLINE'
  return 'SEEN'
}

export function renderOverview(data: CiOverview, now = new Date()): string[] {
  const lines: string[] = []
  const days = windowDays(data.window)
  lines.push(`CI over the last ${days ?? '?'} day(s), where your fixes are tested.`)

  const hosts = (data.hosts ?? []) as Row[]
  const runners = (data.runners ?? []) as Row[]
  const fromHosts = hostRunnerStats(hosts)

  lines.push('')
  lines.push('Machines')
  if (hosts.length === 0) {
    lines.push('  No machine has sent a heartbeat. Run `mushi runner heartbeat --once` on a runner machine to add one.')
  }
  for (const h of hosts) {
    const name = oneLine(str(h, 'hostname') ?? '(unnamed)', 40)
    const platform = str(h, 'platform') ?? '?'
    const cpu = num(h, 'cpuCount', 'cpu_count')
    const memTotal = num(h, 'memTotalMb', 'mem_total_mb')
    const metrics = (field(h, 'metrics') ?? null) as Row | null
    const parts = [
      `${platform}${cpu != null ? `, ${cpu} CPU` : ''}${memTotal != null ? `, ${fmtMb(memTotal)}` : ''}`,
      `last heartbeat ${fmtAgo(str(h, 'lastHeartbeatAt', 'last_heartbeat_at'), now)}${field(h, 'stale') === true ? ' (stale: is the machine off?)' : ''}`,
    ]
    const load = num(metrics, 'load1')
    if (load != null) parts.push(`load ${load.toFixed(1)}`)
    const memUsed = num(metrics, 'memUsedMb', 'mem_used_mb')
    if (memUsed != null) parts.push(`memory ${fmtMb(memUsed)} of ${fmtMb(memTotal)}`)
    const swap = num(metrics, 'swapUsedMb', 'swap_used_mb')
    if (swap != null && swap > 0) parts.push(`swap ${fmtMb(swap)} used`)
    const disk = num(metrics, 'diskFreeGb', 'disk_free_gb')
    if (disk != null) parts.push(`${disk.toFixed(0)} GB disk free`)
    lines.push(`  ${name} (${parts.join(' · ')})`)
  }

  lines.push('')
  lines.push('Runners')
  if (runners.length === 0) lines.push('  No runner seen in this window.')
  for (const r of runners) {
    const name = str(r, 'name', 'runnerName', 'runner_name') ?? '(unnamed)'
    const repo = str(r, 'repo')
    const host = fromHosts.get(name)
    const extra: string[] = []
    const memCur = num(host, 'memCurrentMb', 'mem_current_mb')
    const memMax = num(host, 'memMaxMb', 'mem_max_mb')
    if (memCur != null) extra.push(`memory ${fmtMb(memCur)}${memMax != null ? ` of ${fmtMb(memMax)}` : ''}`)
    const oom = num(host, 'oomKills', 'oom_kills') ?? num(r, 'oomKills', 'oom_kills')
    if (oom != null && oom > 0) extra.push(`${oom} out-of-memory kill(s)`)
    if (host && field(host, 'active') === false) extra.push('service stopped')
    const lastJob = str(r, 'lastJobAt', 'last_job_at')
    if (lastJob) extra.push(`last job ${fmtAgo(lastJob, now)}`)
    lines.push(`  ${runnerState(r).padEnd(8)} ${oneLine(name, 40)}${repo ? `  ${oneLine(repo, 60)}` : ''}${extra.length ? `  (${extra.join(' · ')})` : ''}`)
  }

  const s = data.stats ?? {}
  lines.push('')
  lines.push(`Waiting for a runner: half of jobs started within ${fmtSeconds(s.queueP50s)}, 95% within ${fmtSeconds(s.queueP95s)}.`)
  lines.push(`Run time: half finished within ${fmtSeconds(s.durationP50s)}, 95% within ${fmtSeconds(s.durationP95s)}.`)
  const infra = s.infraFailures ?? 0
  const code = s.codeFailures ?? 0
  const pass = typeof s.passRate === 'number' ? ` Pass rate ${Math.round((s.passRate <= 1 ? s.passRate * 100 : s.passRate))}%.` : ''
  lines.push(`Failures: ${infra} where the test machine stopped (your fix was not tested), ${code} in your code.${pass}`)

  const perms = data.permissions ?? null
  if (perms?.jobs === 'missing') {
    lines.push('Mushi cannot read your CI jobs: give its GitHub connection the Actions: read permission.')
  }
  if (perms?.runners === 'missing') {
    lines.push('Runner online/offline status needs the Administration: read permission on GitHub; showing runners seen in jobs instead.')
  }

  const advice = data.advice ?? []
  lines.push('')
  if (advice.length === 0) {
    lines.push('No advice: nothing in this window looks slow or broken.')
  } else {
    lines.push('What to do first')
    for (const a of advice.slice(0, 3)) {
      lines.push(`  ${String(a.severity).toUpperCase().padEnd(6)} ${oneLine(a.title, 110)}`)
      if (a.detail) lines.push(`        ${oneLine(a.detail, 140)}`)
      if (a.fix) lines.push(`        Fix: ${oneLine(a.fix, 140)}`)
    }
    if (advice.length > 3) lines.push(`  …and ${advice.length - 3} more (--json shows all, with the evidence for each).`)
  }
  return lines
}
