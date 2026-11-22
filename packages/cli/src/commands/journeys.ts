/**
 * FILE: packages/cli/src/commands/journeys.ts
 * PURPOSE: `mushi journeys` and `mushi journeys scan` — terminal parity for
 *          the Journey optimizer (ADR 0058): where people get stuck in the
 *          app, with a suggestion and a paste-ready agent prompt per finding
 *          (GET /v1/admin/projects/:id/journeys), and the site scan that adds
 *          the live site's links (POST /v1/admin/projects/:id/journeys/scan),
 *          and `mushi journeys record` for the on-demand visit recording
 *          window (PUT /v1/admin/projects/:id/journeys/recording).
 *          MCP twins: get_journeys, scan_site_journeys, record_journeys.
 */

import type { Command } from 'commander'
import { apiCall, die, fmtDate, outputIsJson, requireConfig } from '../cli-shared.js'
import { oneLine, resolveProjectId } from '../command-helpers.js'
import { MushiCliError } from '../errors.js'

/** The kinds the route returns (_shared/journey-map.ts). */
const JOURNEY_KINDS = [
  'broken',
  'dead_end',
  'high_exit',
  'loop',
  'reload',
  'duplicate_page',
  'route_variant',
  'duplicate_title',
  'orphan',
  'deep_page',
  'unvisited',
] as const

/** The route reads any other value as 30, so anything else is refused here. */
const DAY_OPTIONS = ['7', '30', '90']

interface ScanSummary {
  id: string
  status: 'running' | 'done' | 'failed'
  baseUrl: string
  pageCount: number
  error: string | null
  createdAt: string
  finishedAt: string | null
}

interface JourneyFinding {
  id: string
  kind: string
  severity: 'high' | 'medium' | 'low'
  pages: string[]
  title: string
  detail: string
  suggestion: string
  prompt: string
}

interface JourneysData {
  days: number
  liveUrl: string | null
  scan: ScanSummary | null
  mapScan: ScanSummary | null
  map: {
    stats: { sessions: number; pageViews: number; pages: number; avgPagesPerSession: number | null; bounceRate: number | null; sampled: boolean }
    score: number
    rootPath: string
    nodes: unknown[]
    edges: unknown[]
    flows: Array<{ pages: string[]; sessions: number }>
    findings: JourneyFinding[]
  }
}

/** Page paths, titles and prompts come from visits and the scanned site: keep line breaks, drop other control characters. */
function safeBlock(text: string | null | undefined): string {
  return String(text ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').trim()
}

function pct(n: number | null): string {
  return n == null ? '—' : `${Math.round(n * 100)}%`
}

function renderJourneys(data: JourneysData, findings: JourneyFinding[], opts: { kind?: string; prompts?: boolean }): string[] {
  const { stats, score, flows } = data.map
  const lines = [
    `Journeys · last ${data.days} days · score ${score}/100`,
    `${stats.sessions} session(s) · ${stats.pageViews} page view(s) · ${stats.pages} page(s) · ` +
      `${stats.avgPagesPerSession ?? '—'} pages/session · bounce ${pct(stats.bounceRate)}${stats.sampled ? ' (newest visits sampled)' : ''}`,
  ]
  if (data.mapScan) {
    lines.push(`Site scan: ${data.mapScan.pageCount} page(s) of ${oneLine(data.mapScan.baseUrl, 80)}, ${fmtDate(data.mapScan.finishedAt ?? data.mapScan.createdAt)}`)
  } else {
    lines.push('No site scan yet. Run: mushi journeys scan')
  }
  if (data.scan?.status === 'running') lines.push('A scan is running; it usually takes a few minutes.')
  else if (data.scan?.status === 'failed' && data.scan.error) lines.push(`The last scan failed: ${oneLine(data.scan.error, 160)}`)

  if (flows.length > 0) {
    lines.push('', 'Common paths:')
    for (const f of flows.slice(0, 5)) lines.push(`  ${f.sessions}×  ${f.pages.map((p) => oneLine(p, 60)).join(' → ')}`)
  }

  lines.push('')
  if (findings.length === 0) {
    lines.push(opts.kind ? `No ${opts.kind} findings.` : 'No findings: nothing in the map gets in people\'s way.')
    return lines
  }
  lines.push(opts.kind ? `${findings.length} ${opts.kind} finding(s):` : `${findings.length} finding(s):`)
  for (const f of findings) {
    lines.push(`  ${f.severity.toUpperCase().padEnd(6)} ${oneLine(f.title, 110)}  [${f.kind}]`)
    if (f.pages.length > 0) lines.push(`         Pages: ${f.pages.slice(0, 5).map((p) => oneLine(p, 60)).join(', ')}${f.pages.length > 5 ? ', …' : ''}`)
    lines.push(`         Fix: ${oneLine(f.suggestion, 160)}`)
    if (opts.prompts) {
      lines.push('         Prompt:')
      for (const l of safeBlock(f.prompt).split('\n')) lines.push(`           ${l}`)
    }
  }
  if (!opts.prompts) lines.push('', 'Add --prompts for a ready prompt per finding to paste into your coding agent.')
  return lines
}

export function registerJourneysCommands(program: Command): void {
  const journeys = program
    .command('journeys')
    .description('Where people get stuck in your app, with a fix prompt per finding (Journey optimizer)')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--days <n>', 'Window of visits: 7, 30 or 90', '30')
    .option('--kind <kind>', `Only findings of one kind (${JOURNEY_KINDS.join(', ')})`)
    .option('--prompts', 'Print each finding\'s prompt for a coding agent')
    .option('--json', 'Machine-readable JSON output (the whole map)')
    .addHelpText('after', `
Examples:
  mushi journeys
  mushi journeys --days 90 --kind dead_end --prompts
  mushi journeys scan --url https://example.com
  mushi journeys record --hours 24 --sample 0.1`)
    .action(async (opts: { projectId?: string; days: string; kind?: string; prompts?: boolean; json?: boolean }) => {
      if (!DAY_OPTIONS.includes(opts.days)) throw new MushiCliError('E_INVALID_INPUT', '--days must be 7, 30 or 90')
      if (opts.kind && !(JOURNEY_KINDS as readonly string[]).includes(opts.kind)) {
        throw new MushiCliError('E_INVALID_INPUT', `--kind must be one of ${JOURNEY_KINDS.join(', ')}`)
      }
      const config = requireConfig()
      const projectId = resolveProjectId(opts.projectId, config.projectId)
      const result = await apiCall<JourneysData>(`/v1/admin/projects/${encodeURIComponent(projectId)}/journeys?days=${opts.days}`, config)
      if (!result.ok) die(result)
      const data = result.data
      const findings = opts.kind ? data.map.findings.filter((f) => f.kind === opts.kind) : data.map.findings
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify({ ...data, map: { ...data.map, findings } }, null, 2))
        return
      }
      for (const line of renderJourneys(data, findings, opts)) console.log(line)
    })

  journeys
    .command('scan')
    .description('Scan the live site (up to 40 pages, no LLM) so the map knows its links; at most once every 10 minutes')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--url <url>', 'The site\'s public https:// address (defaults to the one Mushi Mushi already knows)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { projectId?: string; url?: string; json?: boolean }) => {
      const config = requireConfig()
      const projectId = resolveProjectId(opts.projectId, config.projectId)
      const result = await apiCall<{ scan: ScanSummary }>(`/v1/admin/projects/${encodeURIComponent(projectId)}/journeys/scan`, config, {
        method: 'POST',
        body: JSON.stringify(opts.url ? { base_url: opts.url } : {}),
      })
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      const s = result.data.scan
      console.log(`Scan started for ${oneLine(s.baseUrl, 100)} [${s.id}].`)
      console.log('It usually takes a few minutes. Then run: mushi journeys')
    })

  journeys
    .command('record')
    .description("Open, extend or stop the visit recording window for apps whose SDK uses trackSessions: 'on-demand'")
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--hours <n>', `Record for this many hours from now (1-${RECORDING_MAX_HOURS}); 0 stops`)
    .option('--sample <rate>', 'Share of visitors to record, above 0 and at most 1 (0.1 = one in ten; unset keeps the current share)')
    .option('--stop', 'Stop recording now (same as --hours 0)')
    .option('--json', 'Machine-readable JSON output')
    .addHelpText('after', `
Examples:
  mushi journeys record --hours 24 --sample 0.1
  mushi journeys record --stop`)
    .action(async (opts: { projectId?: string; hours?: string; sample?: string; stop?: boolean; json?: boolean }) => {
      const body = recordingBody(opts)
      const config = requireConfig()
      const projectId = resolveProjectId(opts.projectId, config.projectId)
      const result = await apiCall<{ recording: { until: string | null; sampleRate: number } }>(
        `/v1/admin/projects/${encodeURIComponent(projectId)}/journeys/recording`,
        config,
        { method: 'PUT', body: JSON.stringify(body) },
      )
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      const r = result.data.recording
      if (!r.until) {
        console.log("Recording is off. Apps with trackSessions: 'on-demand' send no visits until you open a new window.")
        return
      }
      console.log(`Recording ${Math.round(r.sampleRate * 100)}% of visitors until ${fmtDate(r.until)}.`)
      console.log("Only apps whose SDK uses trackSessions: 'on-demand' wait for this window. Read the results with: mushi journeys")
    })
}

/** Longest window the route accepts: one week. */
const RECORDING_MAX_HOURS = 168

/** The PUT body, checked the way the route checks it. */
function recordingBody(opts: { hours?: string; sample?: string; stop?: boolean }): { hours: number; sample_rate?: number } {
  if (opts.stop && opts.hours !== undefined) throw new MushiCliError('E_INVALID_INPUT', 'Pass --hours or --stop, not both.')
  if (!opts.stop && opts.hours === undefined) {
    throw new MushiCliError('E_INVALID_INPUT', 'Pass --hours <n> to record, or --stop.', 'e.g. mushi journeys record --hours 24 --sample 0.1')
  }
  const hours = opts.stop ? 0 : Number(opts.hours)
  if (!Number.isInteger(hours) || hours < 0 || hours > RECORDING_MAX_HOURS) {
    throw new MushiCliError('E_INVALID_INPUT', `--hours must be a whole number from 0 to ${RECORDING_MAX_HOURS}`)
  }
  if (opts.sample === undefined) return { hours }
  const rate = Number(opts.sample)
  if (!(rate > 0 && rate <= 1)) throw new MushiCliError('E_INVALID_INPUT', '--sample must be above 0 and at most 1 (0.1 = one visitor in ten)')
  return { hours, sample_rate: rate }
}
