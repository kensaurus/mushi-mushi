/**
 * FILE: packages/cli/src/runner/compare.ts
 * PURPOSE: Terminal view of GET /v1/admin/ci/compare (Plan 022 Phase 7,
 *          ADR 0037): cost and speed per repo × runner class, included
 *          minutes per GitHub account, your machines, speed factors, what-ifs
 *          and cost advice. Every money figure says "estimated"; wait and run
 *          times are measured. Pure: data in, lines out.
 */

/**
 * A tolerant copy of CiCompare in packages/server/supabase/functions/_shared/
 * ci-compare-types.ts (the source of truth): fields optional so an older or
 * newer server still renders.
 */
export interface CiCompare {
  window?: { days?: number } | null
  dataDays?: number
  lowConfidence?: boolean
  source?: 'sql' | 'rows'
  sourceNote?: string | null
  rates?: { fetchedAt?: string; usdPerMinute?: Record<string, number> } | null
  repos?: Array<{ repo: string; visibility?: string; projectName?: string }>
  rows?: Array<{
    repo: string
    runnerClass: string
    os?: string
    labels?: string[]
    runner?: string | null
    machine?: string | null
    jobs?: number
    expired?: number
    queueP95s?: number | null
    runP50s?: number | null
    prPassRate?: number | null
    billedMinutes?: number
    monthCost?: number
    costBasis?: string
    currency?: string
  }>
  accounts?: Array<{ owner: string; plan?: string; includedMinutes?: number; monthMinutes?: number; monthListCost?: number; monthCost?: number; includedLeft?: number; currency?: string }>
  machines?: Array<{ name: string; source?: string; busyHours?: number; busyShare?: number; monthEnergyCost?: number; monthWearCost?: number; queueP95s?: number | null; online?: boolean | null; currency?: string }>
  speed?: Array<{ repo: string; workflow: string; job: string; hostedP50s?: number | null; selfHostedP50s?: number | null; hostedSamples?: number; selfHostedSamples?: number; factor?: number | null }>
  whatIfs?: Array<{
    repo: string
    workflow: string
    from?: { runnerClass?: string; label?: string; machine?: string | null }
    to?: { runnerClass?: string; label?: string; machine?: string | null }
    monthMinutesMoved?: number
    monthCostDelta?: number
    speed?: { factor?: number; measured?: boolean; samplesFrom?: number; samplesTo?: number }
    warnings?: string[]
    stays?: Array<{ job: string; reason: string }>
    currency?: string
  }>
  advice?: Array<{ severity: string; title: string; evidence?: string; fix?: string }>
}

function formatMoney(n: number | null | undefined, currency = 'USD'): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n).toFixed(2)
  const sign = n < 0 ? '−' : ''
  return currency === 'USD' ? `${sign}$${abs}` : `${sign}${abs} ${currency}`
}

function formatDuration(s: number | null | undefined): string {
  if (typeof s !== 'number' || !Number.isFinite(s)) return '—'
  if (s < 90) return `${Math.round(s)} s`
  if (s < 90 * 60) return `${Math.round(s / 60)} min`
  return `${Math.round((s / 3600) * 10) / 10} h`
}

function pct(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—'
}

/** "GitHub-hosted (ubuntu-latest)", "Self-hosted aw-tsumagoi on Alienware", "Never picked up (kensaurus-local)". */
function runsOnLabel(r: { runnerClass: string; labels?: string[]; runner?: string | null; machine?: string | null; os?: string }): string {
  const labels = (r.labels ?? []).filter((l) => l.toLowerCase() !== 'self-hosted').join(', ')
  if (r.runnerClass === 'github_hosted') return `GitHub-hosted${labels ? ` (${labels})` : r.os ? ` (${r.os})` : ''}`
  if (r.runnerClass === 'self_hosted') {
    const who = r.runner || labels || 'self-hosted'
    return `Self-hosted ${who}${r.machine && r.machine !== r.runner ? ` on ${r.machine}` : ''}`
  }
  return `Never picked up${labels ? ` (${labels})` : ''}`
}

const pad = (s: string, n: number) => (s.length >= n ? `${s.slice(0, n - 1)}…` : s.padEnd(n))

export function renderCompare(data: CiCompare, opts: { maxRows?: number } = {}): string[] {
  const lines: string[] = []
  const days = typeof data.window === 'object' && data.window ? data.window.days ?? null : null
  const vis = new Map((data.repos ?? []).map((r) => [r.repo, r.visibility ?? 'unknown']))
  lines.push(`CI cost and speed${days ? `, last ${days} days` : ''} (${data.dataDays ?? 0} days of job data)`)
  if (data.lowConfidence) lines.push('  Low confidence: under 7 days of data. Every figure below will move.')
  if (data.sourceNote) lines.push(`  ${data.sourceNote}`)
  const r = data.rates?.usdPerMinute
  if (r) lines.push(`  GitHub list prices from ${data.rates?.fetchedAt ?? 'unknown date'}: Linux $${r.linux}/min, Windows $${r.windows}/min, macOS $${r.macos}/min.`)
  lines.push('  Wait and run times are measured; minutes billed and money are estimated.')

  const accounts = data.accounts ?? []
  if (accounts.length > 0) {
    lines.push('', 'GitHub accounts (included minutes are per account):')
    for (const a of accounts) {
      lines.push(`  ${a.owner}  ${a.plan ?? '?'} plan, ${(a.includedMinutes ?? 0).toLocaleString('en-US')} included  ·  ~${(a.monthMinutes ?? 0).toLocaleString('en-US')} min a month on private repos  ·  list ${formatMoney(a.monthListCost, a.currency)}  ·  after included ${formatMoney(a.monthCost, a.currency)} (estimated)`)
    }
  }

  const rows = data.rows ?? []
  lines.push('', `${pad('Repo', 36)} ${pad('Runs on', 44)} ${'Jobs'.padStart(5)} ${'Wait p95'.padStart(9)} ${'Run p50'.padStart(8)} ${'PR pass'.padStart(8)} ${'Billed'.padStart(7)} ${'Month (est.)'.padStart(13)}`)
  if (rows.length === 0) lines.push('  No CI jobs in this window.')
  for (const row of rows.slice(0, opts.maxRows ?? 40)) {
    const v = vis.get(row.repo)
    const repo = `${row.repo}${v === 'public' ? ' (public)' : v === 'private' ? ' (private)' : ''}`
    const cost = row.costBasis === 'github_public_free' ? 'free' : row.costBasis === 'github_larger_unpriced' ? 'unpriced' : formatMoney(row.monthCost, row.currency)
    lines.push(
      `${pad(repo, 36)} ${pad(runsOnLabel(row), 44)} ${String(row.jobs ?? 0).padStart(5)} ${formatDuration(row.queueP95s).padStart(9)} ${formatDuration(row.runP50s).padStart(8)} ${pct(row.prPassRate).padStart(8)} ${String(row.billedMinutes ?? 0).padStart(7)} ${cost.padStart(13)}`,
    )
  }
  if (rows.length > (opts.maxRows ?? 40)) lines.push(`  … ${rows.length - (opts.maxRows ?? 40)} more (use --json)`)

  const machines = data.machines ?? []
  if (machines.length > 0) {
    lines.push('', 'Your machines (busy time counts parallel jobs once; electricity is the extra draw under load, your figures):')
    for (const m of machines) {
      lines.push(`  ${m.name}${m.online === false ? ' (offline)' : ''}: busy ${m.busyHours ?? 0} h (${pct(m.busyShare)})  ·  electricity ${formatMoney(m.monthEnergyCost, m.currency)}/month  ·  wear ${formatMoney(m.monthWearCost, m.currency)}/month  ·  wait p95 ${formatDuration(m.queueP95s)}`)
    }
  }

  const measured = (data.speed ?? []).filter((s) => s.factor != null)
  const thin = (data.speed ?? []).filter((s) => s.factor == null)
  if (measured.length > 0 || thin.length > 0) {
    lines.push('', 'Speed, self-hosted vs GitHub-hosted (passed runs, at least 5 on each side):')
    for (const s of measured.slice(0, 10)) {
      lines.push(`  ${s.repo} · ${s.workflow} · ${s.job}: ${formatDuration(s.hostedP50s)} → ${formatDuration(s.selfHostedP50s)} = ${s.factor}× (${s.hostedSamples}/${s.selfHostedSamples} runs)`)
    }
    if (thin.length > 0) lines.push(`  ${thin.length} more job${thin.length === 1 ? '' : 's'} ran on both but with too few passed runs to measure.`)
  }

  const whatIfs = data.whatIfs ?? []
  if (whatIfs.length > 0) {
    lines.push('', 'What if (estimated, 30 days):')
    for (const w of whatIfs.slice(0, 6)) {
      const to = w.to?.machine ?? w.to?.label ?? w.to?.runnerClass ?? '?'
      const speed = w.speed?.measured ? `${w.speed.factor}× measured (${w.speed.samplesFrom}/${w.speed.samplesTo} runs)` : 'speed not measured, assuming 1.0'
      lines.push(`  Move ${w.repo} · ${w.workflow} to ${to}: ${formatMoney(w.monthCostDelta, w.currency)} a month, ${(w.monthMinutesMoved ?? 0).toLocaleString('en-US')} min moved, ${speed}`)
      for (const s of (w.stays ?? []).slice(0, 3)) lines.push(`      stays: ${s.job} — ${s.reason}`)
      for (const warn of w.warnings ?? []) lines.push(`      ! ${warn}`)
    }
  }

  const advice = data.advice ?? []
  if (advice.length > 0) {
    lines.push('', 'Cost advice:')
    for (const a of advice.slice(0, 6)) {
      lines.push(`  ${a.severity.toUpperCase().padEnd(7)} ${a.title}`)
      if (a.evidence) lines.push(`          ${a.evidence}`)
      if (a.fix) lines.push(`          Fix: ${a.fix}`)
    }
  }
  return lines
}
