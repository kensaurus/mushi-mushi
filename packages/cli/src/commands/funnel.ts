/**
 * FILE: packages/cli/src/commands/funnel.ts
 * PURPOSE: `mushi funnel show|set|growth` — console parity for the team
 *          funnel (one funnel run over every app, GET/PUT
 *          /v1/admin/orgs/:orgId/funnel) and the operator growth funnel
 *          (GET /v1/admin/growth/funnel). All three need an account-level key.
 */

import type { Command } from 'commander'
import { apiCall, die, outputIsJson, requireConfig } from '../cli-shared.js'
import { dieOrgError, oneLine, orgSegment } from '../command-helpers.js'
import { MushiCliError } from '../errors.js'

interface FunnelStep { name: string; entered: number; converted: number; pct: number }

interface OrgFunnelData {
  state: 'ok' | 'not_set_up'
  definition: { steps: string[]; window: string; lookbackDays: number; updatedAt: string } | null
  from?: string
  to?: string
  rows: Array<{ projectId: string; name: string; state: 'ok' | 'off' | 'no_events' | 'error'; steps: FunnelStep[]; overallPct: number | null }>
}

interface GrowthFunnelData {
  weeks: Array<Record<string, unknown>>
  by_source: Array<Record<string, unknown>>
  window_start: string | null
  window_end: string | null
  source: string
  self_project_configured: boolean
}

const EVENT_RE = /^[a-z][a-z0-9_]{1,63}$/
const WINDOWS = ['1d', '7d', '30d'] as const

/** Validate `--steps a,b,c` the same way the server does, so a typo fails before the request. */
function parseFunnelSteps(raw: string): string[] {
  const steps = raw.split(',').map((s) => s.trim()).filter(Boolean)
  if (steps.length < 2 || steps.length > 8) {
    throw new MushiCliError('E_INVALID_INPUT', 'A funnel needs 2 to 8 steps.', 'e.g. --steps signup,first_report,fix_merged')
  }
  const bad = steps.filter((s) => !EVENT_RE.test(s))
  if (bad.length > 0) {
    throw new MushiCliError('E_INVALID_INPUT', `Not an event name: ${bad.join(', ')}`, 'event names are lowercase letters, digits and _')
  }
  if (new Set(steps).size !== steps.length) {
    throw new MushiCliError('E_INVALID_INPUT', 'Each step must be a different event.')
  }
  return steps
}

function renderOrgFunnel(data: OrgFunnelData): string[] {
  if (data.state === 'not_set_up' || !data.definition) {
    return ['No team funnel yet. Set one with: mushi funnel set --steps signup,first_report,fix_merged']
  }
  const d = data.definition
  const lines = [`Funnel: ${d.steps.join(' → ')}  (window ${d.window}, last ${d.lookbackDays} days)`]
  for (const r of data.rows) {
    const label = oneLine(r.name, 30).padEnd(30)
    if (r.state === 'off') lines.push(`  ${label} product events are off`)
    else if (r.state === 'error') lines.push(`  ${label} could not be read`)
    else if (r.state === 'no_events') lines.push(`  ${label} nobody entered the first step yet`)
    else lines.push(`  ${label} ${String(r.overallPct ?? 0).padStart(5)}%  ${r.steps.map((s) => `${s.name} ${s.converted}`).join(' → ')}`)
  }
  return lines
}

function renderGrowthFunnel(data: GrowthFunnelData): string[] {
  const lines = [`Growth funnel (${data.source}) ${data.window_start ?? '—'} → ${data.window_end ?? '—'}`]
  if (!data.self_project_configured) lines.push('  Note: the self-analytics project is not configured, so product steps may read zero.')
  if (data.weeks.length === 0) lines.push('  No weeks in this window.')
  for (const w of data.weeks) {
    const week = String(w['week'] ?? w['week_start'] ?? '')
    const rest = Object.entries(w).filter(([k]) => k !== 'week' && k !== 'week_start').map(([k, v]) => `${k} ${String(v)}`).join(' · ')
    lines.push(`  ${week.padEnd(12)} ${rest}`)
  }
  return lines
}

export function registerFunnelCommands(program: Command): void {
  const funnel = program
    .command('funnel')
    .description('One funnel across every app in your team (needs an account-level key)')

  funnel
    .command('show')
    .description('Conversion per app for the team funnel')
    .option('--org <id>', 'Organization UUID (default: your only organization)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { org?: string; json?: boolean }) => {
      const config = requireConfig()
      const result = await apiCall<OrgFunnelData>(`/v1/admin/orgs/${orgSegment(opts.org)}/funnel`, config)
      if (!result.ok) dieOrgError(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      for (const line of renderOrgFunnel(result.data)) console.log(line)
    })

  funnel
    .command('set')
    .description("Set the team funnel's steps (team owners and admins)")
    .requiredOption('--steps <events>', 'Comma-separated event names, 2 to 8, in order')
    .option('--window <w>', `Conversion window: ${WINDOWS.join(' | ')}`, '7d')
    .option('--lookback <days>', 'Days of history to read (1-365)', '30')
    .option('--org <id>', 'Organization UUID (default: your only organization)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { steps: string; window: string; lookback: string; org?: string; json?: boolean }) => {
      const steps = parseFunnelSteps(opts.steps)
      if (!(WINDOWS as readonly string[]).includes(opts.window)) {
        throw new MushiCliError('E_INVALID_INPUT', `--window must be one of ${WINDOWS.join(', ')}`)
      }
      const lookbackDays = Number(opts.lookback)
      if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 365) {
        throw new MushiCliError('E_INVALID_INPUT', '--lookback must be a whole number of days from 1 to 365')
      }
      const config = requireConfig()
      const result = await apiCall<{ steps: string[]; window: string; lookbackDays: number; updatedAt: string }>(
        `/v1/admin/orgs/${orgSegment(opts.org)}/funnel`,
        config,
        { method: 'PUT', body: JSON.stringify({ steps, window: opts.window, lookbackDays }) },
      )
      if (!result.ok) dieOrgError(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      console.log(`Saved: ${result.data.steps.join(' → ')} (window ${result.data.window}, last ${result.data.lookbackDays} days)`)
    })

  funnel
    .command('growth')
    .description("Mushi's own weekly growth funnel (operators only)")
    .option('--weeks <n>', 'Weeks to show', '8')
    .option('--source <source>', 'Signup source, or all', 'all')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { weeks: string; source: string; json?: boolean }) => {
      const config = requireConfig()
      const qs = new URLSearchParams({ weeks: opts.weeks, source: opts.source })
      const result = await apiCall<GrowthFunnelData>(`/v1/admin/growth/funnel?${qs}`, config)
      if (!result.ok) {
        if (result.error.code.endsWith('_NEEDS_ACCOUNT_KEY')) dieOrgError(result)
        die(result)
      }
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      for (const line of renderGrowthFunnel(result.data)) console.log(line)
    })
}
