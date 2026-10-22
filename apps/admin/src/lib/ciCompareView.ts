/**
 * FILE: apps/admin/src/lib/ciCompareView.ts
 * PURPOSE: Pure helpers behind /ci "Cost and speed" (Plan 022 Phase 7,
 *          ADR 0037): money and labels, rows grouped per repo, and the
 *          "why this costs what it costs" facts built from the compare
 *          response. Every money figure is an estimate and is labelled so.
 */

import type { CiCompare, CiCompareRow, CiCompareSettings, RepoVisibility } from './ciCompareTypes'

/** "$12.30", "¥31", "< $0.01"; "—" for nothing. */
export function formatMoney(n: number | null | undefined, currency = 'USD'): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  let fmt: Intl.NumberFormat
  try {
    fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 })
  } catch {
    fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
  }
  if (n !== 0 && Math.abs(n) < 0.01) return `< ${fmt.format(0.01 * Math.sign(n))}`
  return fmt.format(n)
}

/** A signed delta: "−$12.30" saves, "+$0.45" costs more. */
export function formatDelta(n: number, currency = 'USD'): string {
  if (n === 0) return formatMoney(0, currency)
  return `${n < 0 ? '−' : '+'}${formatMoney(Math.abs(n), currency)}`
}

export function formatMinutes(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return `${Math.round(n).toLocaleString('en-US')} min`
}

export function formatPercent(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—'
}

/** Where a row runs, in words. */
export function runsOnText(r: Pick<CiCompareRow, 'runnerClass' | 'labels' | 'runner' | 'machine' | 'os'>): { title: string; detail: string | null } {
  const labels = r.labels.filter((l) => l.toLowerCase() !== 'self-hosted').join(', ')
  if (r.runnerClass === 'github_hosted') {
    return { title: r.os === 'macos' ? 'GitHub-hosted macOS' : r.os === 'windows' ? 'GitHub-hosted Windows' : 'GitHub-hosted', detail: labels || null }
  }
  if (r.runnerClass === 'self_hosted') {
    const machine = r.machine && r.machine !== r.runner ? r.machine : null
    return { title: machine ? `Your machine: ${machine}` : 'Your machine', detail: [r.runner, labels].filter(Boolean).join(' · ') || null }
  }
  return { title: 'Never picked up', detail: labels ? `Waiting for “${labels}”` : null }
}

/** The cost cell: a figure, "free", or why there is none. */
export function costText(r: Pick<CiCompareRow, 'costBasis' | 'monthCost' | 'currency'>): { text: string; note: string } {
  switch (r.costBasis) {
    case 'github_public_free':
      return { text: 'Free', note: 'Public repository: GitHub-hosted minutes cost nothing.' }
    case 'github_larger_unpriced':
      return { text: 'Not priced', note: 'A larger GitHub runner: always billed, at a price Mushi does not have.' }
    case 'github_list':
      return { text: formatMoney(r.monthCost, r.currency), note: r.monthCost === 0 ? 'Inside your plan’s included minutes.' : 'GitHub’s list price after included minutes, 30 days.' }
    case 'self_hosted':
      return { text: formatMoney(r.monthCost, r.currency), note: 'Extra electricity while busy, plus wear, from your figures.' }
    default:
      return { text: '—', note: 'Never ran, so it cost nothing.' }
  }
}

export interface RepoCostGroup {
  repo: string
  projectName: string | null
  visibility: RepoVisibility
  rows: CiCompareRow[]
  monthCost: number
  currency: string
}

/** Rows per repo, the most expensive repo first, GitHub-hosted before self-hosted within a repo. */
export function groupRowsByRepo(data: Pick<CiCompare, 'rows' | 'repos'>): RepoCostGroup[] {
  const meta = new Map(data.repos.map((r) => [r.repo, r]))
  const groups = new Map<string, RepoCostGroup>()
  for (const row of data.rows) {
    let g = groups.get(row.repo)
    if (!g) {
      const m = meta.get(row.repo)
      g = { repo: row.repo, projectName: m?.projectName ?? null, visibility: m?.visibility ?? 'unknown', rows: [], monthCost: 0, currency: row.currency }
      groups.set(row.repo, g)
    }
    g.rows.push(row)
    g.monthCost += row.monthCost
  }
  const order: Record<CiCompareRow['runnerClass'], number> = { github_hosted: 0, self_hosted: 1, unknown: 2 }
  for (const g of groups.values()) g.rows.sort((a, b) => order[a.runnerClass] - order[b.runnerClass] || b.jobs - a.jobs)
  return [...groups.values()].sort((a, b) => b.monthCost - a.monthCost || a.repo.localeCompare(b.repo))
}

export interface CostFact {
  id: string
  title: string
  detail: string
  /** From this window's data; null for a standing rule. */
  evidence: string | null
  /** Lists (pinned jobs, always-hosted jobs). */
  items?: Array<{ key: string; label: string; note: string | null }>
  /** True when this window's data shows it happening. */
  applies: boolean
}

/** "Why this costs what it costs": the standing rules, each with this window's evidence when there is some. */
export function costFacts(data: CiCompare): CostFact[] {
  const ex = data.explain
  const currency = data.settings[0]?.currency ?? 'USD'
  const publicRepos = data.repos.filter((r) => r.visibility === 'public').map((r) => r.repo)
  const facts: CostFact[] = []

  facts.push({
    id: 'public_free',
    title: 'Public repositories run GitHub minutes free',
    detail: 'GitHub charges nothing for standard GitHub-hosted runners on a public repository. Your own machine still costs electricity there, and anyone can open a pull request from a fork.',
    evidence: publicRepos.length > 0 ? `Public here: ${publicRepos.join(', ')}.` : null,
    applies: publicRepos.length > 0,
  })

  const paying = data.accounts.filter((a) => a.privateRepos > 0)
  facts.push({
    id: 'included_minutes',
    title: 'Private repositories pay after the included minutes',
    detail: 'Each GitHub account gets included minutes a month (Free 2,000, Pro and Team 3,000), shared by all its private repositories. After that every minute is billed. Mushi estimates from job times; the bill on GitHub is the real figure.',
    evidence:
      paying.length > 0
        ? paying
            .map((a) => `${a.owner}: about ${a.monthMinutes.toLocaleString('en-US')} min a month on private repos, ${a.includedMinutes.toLocaleString('en-US')} included (${a.plan}), about ${formatMoney(a.monthCost, a.currency)} after them.`)
            .join(' ')
        : null,
    applies: paying.some((a) => a.monthCost > 0),
  })

  facts.push({
    id: 'rounding',
    title: 'Every job bills at least one whole minute',
    detail: 'GitHub rounds each job up to the next minute. A 7-second check costs as much as a 60-second one, so many tiny jobs cost more than one job that runs them as steps.',
    evidence: ex.tinyJobs.jobs > 0 ? `${ex.tinyJobs.jobs} jobs under 20 s on paid runners ran ${ex.tinyJobs.rawMinutes} min and billed ${ex.tinyJobs.billedMinutes} min.` : null,
    applies: ex.tinyJobs.jobs >= 10,
  })

  const mac = data.rows.filter((r) => r.os === 'macos' && r.runnerClass === 'github_hosted')
  facts.push({
    id: 'macos',
    title: `macOS minutes cost about ${ex.macosToLinux}× Linux`,
    detail: `GitHub lists Linux at $${data.rates.usdPerMinute.linux}, Windows at $${data.rates.usdPerMinute.windows} and macOS at $${data.rates.usdPerMinute.macos} a minute (read ${data.rates.fetchedAt}).`,
    evidence: mac.length > 0 ? `${mac.reduce((n, r) => n + r.billedMinutes, 0).toLocaleString('en-US')} macOS minutes in this window.` : null,
    applies: mac.length > 0,
  })

  facts.push({
    id: 'reruns',
    title: 'Re-runs bill again on GitHub, and cost nothing extra on your machine',
    detail: 'A re-run is a new job: on GitHub-hosted runners its minutes are billed again. On your own machine a re-run only uses electricity.',
    evidence:
      ex.reruns.hostedJobs + ex.reruns.selfHostedJobs > 0
        ? `${ex.reruns.hostedJobs} re-run jobs on paid GitHub runners (${ex.reruns.hostedBilledMinutes} min billed); ${ex.reruns.selfHostedJobs} on your machines.`
        : null,
    applies: ex.reruns.hostedJobs > 0,
  })

  facts.push({
    id: 'pinned',
    title: 'Some jobs are pinned to GitHub on purpose',
    detail: 'These jobs name a GitHub runner in the workflow, so no runner setting moves them. The reason is the comment next to it.',
    evidence: ex.pinned.length > 0 ? null : 'No pinned job ran on a private repo in this window.',
    items: ex.pinned.map((p) => ({ key: `${p.repo}|${p.workflow}|${p.job}`, label: `${p.repo} · ${p.workflow} · ${p.job}: ${formatMoney(p.monthCost, currency)} a month`, note: p.reason ? `“${p.reason}”` : 'No reason given in the workflow.' })),
    applies: ex.pinned.length > 0,
  })

  facts.push({
    id: 'always_hosted',
    title: 'Main-branch and Dependabot runs always use GitHub',
    detail: 'Workflows that read a runner variable often check github.ref or github.actor first, so pushes to main and Dependabot updates use GitHub-hosted runners whatever the variable says.',
    evidence: null,
    items: ex.alwaysHosted.map((a) => ({
      key: `${a.repo}|${a.workflow}|${a.job}`,
      label: `${a.repo} · ${a.workflow} · ${a.job}`,
      note: a.why === 'main_and_dependabot' ? 'main and Dependabot' : a.why === 'main' ? 'main' : 'Dependabot',
    })),
    applies: ex.alwaysHosted.length > 0,
  })

  facts.push({
    id: 'runner_size',
    title: 'GitHub gives private repositories smaller machines',
    detail: `A standard runner has ${ex.hostedSpecs.privateVcpu} CPUs and ${ex.hostedSpecs.privateRamGb} GB on a private repository, ${ex.hostedSpecs.publicVcpu} CPUs and ${ex.hostedSpecs.publicRamGb} GB on a public one. That is often why your own machine is faster for private repos.`,
    evidence: null,
    applies: false,
  })

  facts.push({
    id: 'expired',
    title: 'A job nobody picked up cost nothing, and was never tested',
    detail: 'GitHub cancels a job no runner takes within 24 hours. It bills nothing, but the fix it was testing waited a day and was not tested.',
    evidence: ex.queueExpired.jobs > 0 ? `${ex.queueExpired.jobs} jobs expired waiting for a runner.` : null,
    applies: ex.queueExpired.jobs > 0,
  })

  facts.push({
    id: 'platform_fee',
    title: 'Self-hosted runners are free on GitHub, for now',
    detail: `GitHub announced a $${ex.platformFeeWhatIf.perMinuteUsd} a minute platform fee for self-hosted runners, then postponed it. Mushi counts it as 0 unless you set it in Settings → CI cost.`,
    evidence: ex.platformFeeWhatIf.monthCost > 0 ? `If it started, your self-hosted minutes would cost about ${formatMoney(ex.platformFeeWhatIf.monthCost, currency)} a month.` : null,
    applies: false,
  })

  return facts
}

/** Settings → CI cost: the form values as strings, for inputs. */
export interface CostDraft {
  currency: string
  fxPerUsd: string
  wattsIdle: string
  wattsLoad: string
  pricePerKwh: string
  wearPerHour: string
  plan: CiCompareSettings['plan']
  includedMinutes: string
  selfHostedFeePerMinuteUsd: string
  /** One machine per line: "Name: prefix-a, prefix-b", or "Name (30-180 W): …" with its own idle and load watts. */
  machines: string
}

export function draftFromCostSettings(s: CiCompareSettings): CostDraft {
  return {
    currency: s.currency,
    fxPerUsd: String(s.fxPerUsd),
    wattsIdle: String(s.wattsIdle),
    wattsLoad: String(s.wattsLoad),
    pricePerKwh: String(s.pricePerKwh),
    wearPerHour: String(s.wearPerHour),
    plan: s.plan,
    includedMinutes: String(s.includedMinutes),
    selfHostedFeePerMinuteUsd: String(s.selfHostedFeePerMinuteUsd),
    machines: s.machines
      .map((m) => `${m.name}${m.wattsIdle != null && m.wattsLoad != null ? ` (${m.wattsIdle}-${m.wattsLoad} W)` : ''}: ${m.runners.join(', ')}`)
      .join('\n'),
  }
}

export const PLAN_INCLUDED_MINUTES: Record<Exclude<CiCompareSettings['plan'], 'custom'>, number> = { free: 2000, pro: 3000, team: 3000, enterprise: 50000 }

export type CostErrors = Partial<Record<keyof CostDraft, string>>

/** Parse "Name: a, b" lines; null with an error for a bad line. */
export function parseMachines(text: string, maxMachines = 20, maxRunners = 20): { machines: CiCompareSettings['machines']; error: string | null } {
  const machines: CiCompareSettings['machines'] = []
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length > maxMachines) return { machines: [], error: `At most ${maxMachines} machines.` }
  for (const [i, line] of lines.entries()) {
    const at = line.indexOf(':')
    if (at <= 0) return { machines: [], error: `Line ${i + 1}: write “Name: runner-a, runner-b”.` }
    let name = line.slice(0, at).trim()
    let watts: { idle: number; load: number } | null = null
    const w = /^(.*?)\s*\(\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*W\s*\)$/i.exec(name)
    if (w) {
      name = w[1].trim()
      watts = { idle: Number(w[2]), load: Number(w[3]) }
      if (watts.load < watts.idle) return { machines: [], error: `Line ${i + 1}: the load watts must be at least the idle watts.` }
      if (watts.load > 5000) return { machines: [], error: `Line ${i + 1}: at most 5,000 W.` }
    }
    if (!name) return { machines: [], error: `Line ${i + 1}: give the machine a name before the colon.` }
    const runners = [...new Set(line.slice(at + 1).split(',').map((r) => r.trim()).filter(Boolean))]
    if (name.length > 60) return { machines: [], error: `Line ${i + 1}: the name is over 60 characters.` }
    if (runners.length === 0) return { machines: [], error: `Line ${i + 1}: list at least one runner name or prefix after the colon.` }
    if (runners.length > maxRunners) return { machines: [], error: `Line ${i + 1}: at most ${maxRunners} runners.` }
    if (runners.some((r) => r.length > 100)) return { machines: [], error: `Line ${i + 1}: a runner name is over 100 characters.` }
    if (machines.some((m) => m.name.toLowerCase() === name.toLowerCase())) return { machines: [], error: `Line ${i + 1}: “${name}” is listed twice.` }
    machines.push(watts ? { name, runners, wattsIdle: watts.idle, wattsLoad: watts.load } : { name, runners })
  }
  return { machines, error: null }
}

function num(v: string): number {
  return v.trim() === '' ? NaN : Number(v)
}

/** Client-side checks with the server's bounds; the server checks again. */
export function validateCostDraft(d: CostDraft, bounds: { watts: { min: number; max: number }; pricePerKwh: { min: number; max: number }; wearPerHour: { min: number; max: number }; fxPerUsd: { min: number; max: number }; includedMinutes: { min: number; max: number }; selfHostedFeePerMinuteUsd: { min: number; max: number } }): CostErrors {
  const e: CostErrors = {}
  const within = (key: keyof CostDraft, v: number, b: { min: number; max: number }, unit: string) => {
    if (!Number.isFinite(v)) e[key] = 'Enter a number.'
    else if (v < b.min || v > b.max) e[key] = `Between ${b.min} and ${b.max.toLocaleString('en-US')}${unit}.`
  }
  if (!/^[A-Z]{3}$/.test(d.currency.trim())) e.currency = 'A 3-letter code, e.g. USD, JPY, EUR.'
  if (d.currency.trim() !== 'USD') within('fxPerUsd', num(d.fxPerUsd), bounds.fxPerUsd, '')
  within('wattsIdle', num(d.wattsIdle), bounds.watts, ' W')
  within('wattsLoad', num(d.wattsLoad), bounds.watts, ' W')
  if (!e.wattsIdle && !e.wattsLoad && num(d.wattsLoad) < num(d.wattsIdle)) e.wattsLoad = 'At least the idle draw.'
  within('pricePerKwh', num(d.pricePerKwh), bounds.pricePerKwh, '')
  within('wearPerHour', num(d.wearPerHour), bounds.wearPerHour, '')
  const inc = num(d.includedMinutes)
  within('includedMinutes', inc, bounds.includedMinutes, ' min')
  if (!e.includedMinutes && !Number.isInteger(inc)) e.includedMinutes = 'Whole minutes.'
  within('selfHostedFeePerMinuteUsd', num(d.selfHostedFeePerMinuteUsd), bounds.selfHostedFeePerMinuteUsd, ' USD')
  const m = parseMachines(d.machines)
  if (m.error) e.machines = m.error
  return e
}

/** The PUT body for a valid draft. */
export function costSettingsBody(organizationId: string, d: CostDraft) {
  const currency = d.currency.trim()
  return {
    organizationId,
    currency,
    fxPerUsd: currency === 'USD' ? 1 : Number(d.fxPerUsd),
    wattsIdle: Number(d.wattsIdle),
    wattsLoad: Number(d.wattsLoad),
    pricePerKwh: Number(d.pricePerKwh),
    wearPerHour: Number(d.wearPerHour),
    plan: d.plan,
    includedMinutes: Number(d.includedMinutes),
    selfHostedFeePerMinuteUsd: Number(d.selfHostedFeePerMinuteUsd),
    machines: parseMachines(d.machines).machines,
  }
}
