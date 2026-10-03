/**
 * FILE: packages/cli/src/commands/releases.ts
 * PURPOSE: `mushi releases …` — console parity for the Releases page and the
 *          team release calendar:
 *            list | stats | show | draft | edit | delete | publish  → /v1/admin/releases*
 *            calendar                                              → /v1/admin/orgs/:orgId/releases
 *          `publish` messages every credited reporter, and `delete` removes a
 *          draft, so both need --yes.
 */

import type { Command } from 'commander'
import { readFileSync } from 'node:fs'
import type { ApiOk } from '../cli-shared.js'
import { apiCall, die, fmtDate, outputIsJson, pad, requireConfig, requireUuid } from '../cli-shared.js'
import { dieOrgError, oneLine, orgSegment, requireYes, resolveProjectId } from '../command-helpers.js'
import { MushiCliError } from '../errors.js'

/** release-builder reads merged fixes and writes notes; give it longer than the 15 s default. */
const DRAFT_TIMEOUT_MS = 120_000
/** Publishing messages each credited reporter before it answers. */
const PUBLISH_TIMEOUT_MS = 60_000

export interface ReleaseRow {
  id: string
  project_id: string
  version: string
  title: string | null
  status: 'draft' | 'published'
  published_at: string | null
  credited_reporter_ids: string[] | null
  fixed_report_ids: string[] | null
  fulfilled_ticket_ids: string[] | null
  created_at: string
  body_md?: string | null
  credits?: Array<{ id: string; display_name_at_time: string | null; contribution_type: string; notified_at: string | null }>
}

/** POST /v1/admin/releases/draft answers release-builder's payload. */
export interface ReleaseDraftData {
  release: ReleaseRow
  creditCount: number
  reportCount: number
}

export interface ReleaseDelivery {
  reports_listed: number
  reports_resolved: number
  reporters_notified: number
  reporters_held: number
  reporters_failed: number
  credits_stamped?: number
  credits_pending?: number
}

export interface ReleaseCalendarData {
  rows: Array<{
    projectId: string
    name: string
    stage: string
    mergedNotBuilt: number
    builtNotSubmitted: number | null
    otaPending: number
    live: { version: string; rolloutPct: number | null } | null
  }>
  batchSuggestion: { otaNow: string[]; nextStoreBatch: string[]; ciMinutesNow: number; ciMinutesBatched: number; note: string } | null
  note?: string
}

export function renderReleaseList(rows: ReleaseRow[], total: number): string[] {
  if (rows.length === 0) return ['No releases yet. Draft one with: mushi releases draft 1.2.0']
  const lines = [`${pad('VERSION', 12)}${pad('STATUS', 11)}${pad('FIXES', 7)}${pad('CREATED', 18)}ID`]
  for (const r of rows) {
    lines.push(`${pad(r.version, 12)}${pad(r.status, 11)}${pad(String(r.fixed_report_ids?.length ?? 0), 7)}${pad(fmtDate(r.created_at), 18)}${r.id}`)
  }
  if (total > rows.length) lines.push(`… ${total - rows.length} more (use --limit / --offset)`)
  return lines
}

export function renderPublish(release: ReleaseRow, delivery: ReleaseDelivery | undefined, ticketsFulfilled: number | undefined): string[] {
  const lines = [`Published ${release.version}.`]
  if (delivery) {
    lines.push(`  Reports resolved: ${delivery.reports_resolved} of ${delivery.reports_listed}`)
    lines.push(`  Reporters messaged: ${delivery.reporters_notified}, held for review: ${delivery.reporters_held}, failed: ${delivery.reporters_failed}`)
    if (delivery.reporters_held > 0) lines.push('  Held messages wait in the outbox: mushi outbox list')
  }
  if (ticketsFulfilled) lines.push(`  Support tickets marked shipped: ${ticketsFulfilled}`)
  return lines
}

export function renderCalendar(data: ReleaseCalendarData): string[] {
  if (data.rows.length === 0) return ['No apps in this team yet.']
  const lines: string[] = []
  for (const r of data.rows) {
    const live = r.live ? `live ${r.live.version}${r.live.rolloutPct != null && r.live.rolloutPct < 100 ? ` at ${r.live.rolloutPct}%` : ''}` : 'not live yet'
    lines.push(`  ${pad(r.stage, 18)} ${pad(oneLine(r.name, 28), 29)} ${live} · ${r.mergedNotBuilt} native change(s) to build · ${r.otaPending} OTA fix(es)`)
  }
  if (data.batchSuggestion) lines.push(data.batchSuggestion.note)
  if (data.note) lines.push(data.note)
  return lines
}

function readBody(path: string | undefined): string | undefined {
  if (!path) return undefined
  try {
    return readFileSync(path, 'utf8')
  } catch (err) {
    throw new MushiCliError('E_FILE_NOT_FOUND', `Could not read ${path}`, 'pass a Markdown file you can read', err)
  }
}

export function registerReleasesCommands(program: Command): void {
  const releases = program
    .command('releases')
    .description('Release notes that credit your reporters and tell them the fix shipped')

  releases
    .command('list')
    .description('Drafts and published releases, newest first')
    .option('--status <status>', 'draft | published')
    .option('--project-id <id>', 'Only this project')
    .option('--limit <n>', 'How many (max 100)', '20')
    .option('--offset <n>', 'Skip this many', '0')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { status?: string; projectId?: string; limit: string; offset: string; json?: boolean }) => {
      if (opts.status && opts.status !== 'draft' && opts.status !== 'published') {
        throw new MushiCliError('E_INVALID_INPUT', '--status must be draft or published')
      }
      const config = requireConfig()
      const qs = new URLSearchParams({ limit: opts.limit, offset: opts.offset })
      if (opts.status) qs.set('status', opts.status)
      if (opts.projectId) qs.set('project_id', requireUuid(opts.projectId, 'project id'))
      const result = await apiCall<ReleaseRow[]>(`/v1/admin/releases?${qs}`, config)
      if (!result.ok) die(result)
      const total = Number((result.meta as { total?: number } | undefined)?.total ?? result.data.length)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify({ releases: result.data, total }, null, 2))
        return
      }
      for (const line of renderReleaseList(result.data, total)) console.log(line)
    })

  releases
    .command('stats')
    .description('Drafts, published releases, credited reporters and what to do next')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { json?: boolean }) => {
      const config = requireConfig()
      const result = await apiCall<Record<string, unknown>>('/v1/admin/releases/stats', config)
      if (!result.ok) die(result)
      const d = result.data
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(d, null, 2))
        return
      }
      console.log(`Releases: ${String(d['draftCount'] ?? 0)} draft, ${String(d['publishedCount'] ?? 0)} published · fixes linked ${String(d['totalFixesLinked'] ?? 0)} · reporters credited ${String(d['totalCredits'] ?? 0)} (${String(d['creditsPending'] ?? 0)} not told yet)`)
      if (typeof d['topPriorityLabel'] === 'string') console.log(`Next: ${d['topPriorityLabel']}`)
    })

  releases
    .command('show <releaseId>')
    .description('One release with its notes and credited reporters')
    .option('--json', 'Machine-readable JSON output')
    .action(async (releaseId: string, opts: { json?: boolean }) => {
      const id = requireUuid(releaseId, 'release id')
      const config = requireConfig()
      const result = await apiCall<ReleaseRow>(`/v1/admin/releases/${id}`, config)
      if (!result.ok) die(result)
      const r = result.data
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(r, null, 2))
        return
      }
      console.log(`${r.version} — ${oneLine(r.title ?? '(untitled)', 80)} [${r.status}${r.published_at ? ` ${fmtDate(r.published_at)}` : ''}]`)
      console.log(`Fixed reports: ${r.fixed_report_ids?.length ?? 0} · credited reporters: ${r.credits?.length ?? 0}`)
      if (r.body_md) console.log(`\n${r.body_md}`)
    })

  releases
    // The version is positional: a `--version` flag would collide with the
    // root program's `mushi --version`.
    .command('draft <version>')
    .description('Draft notes from the fixes merged in a window (nothing is sent)')
    .option('--title <title>', 'Release title')
    .option('--since <iso>', 'Window start (ISO date); default: since the last release')
    .option('--until <iso>', 'Window end (ISO date); default: now')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (version: string, opts: { title?: string; since?: string; until?: string; projectId?: string; json?: boolean }) => {
      const config = requireConfig()
      const projectId = resolveProjectId(opts.projectId, config.projectId)
      const body: Record<string, string> = { project_id: projectId, version }
      if (opts.title) body['title'] = opts.title
      if (opts.since) body['window_start'] = opts.since
      if (opts.until) body['window_end'] = opts.until
      const result = await apiCall<ReleaseDraftData>('/v1/admin/releases/draft', config, { method: 'POST', body: JSON.stringify(body) }, { timeoutMs: DRAFT_TIMEOUT_MS })
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      const r = result.data.release
      console.log(`Drafted ${r.version} (${r.id}) from ${result.data.reportCount} fixed report(s), crediting ${result.data.creditCount} reporter(s).`)
      console.log(`Review it with \`mushi releases show ${r.id}\`, then: mushi releases publish ${r.id} --yes`)
    })

  releases
    .command('edit <releaseId>')
    .description('Change a draft: title, version or notes')
    .option('--title <title>', 'New title')
    .option('--set-version <version>', 'New version')
    .option('--body-file <path>', 'Replace the notes with this Markdown file')
    .option('--json', 'Machine-readable JSON output')
    .action(async (releaseId: string, opts: { title?: string; setVersion?: string; bodyFile?: string; json?: boolean }) => {
      const id = requireUuid(releaseId, 'release id')
      const patch: Record<string, string> = {}
      if (opts.title) patch['title'] = opts.title
      if (opts.setVersion) patch['version'] = opts.setVersion
      const bodyMd = readBody(opts.bodyFile)
      if (bodyMd !== undefined) patch['body_md'] = bodyMd
      if (Object.keys(patch).length === 0) {
        throw new MushiCliError('E_INVALID_INPUT', 'Nothing to change.', 'pass --title, --set-version or --body-file')
      }
      const config = requireConfig()
      const result = await apiCall<ReleaseRow>(`/v1/admin/releases/${id}`, config, { method: 'PATCH', body: JSON.stringify(patch) })
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      console.log(`Saved draft ${result.data.version}.`)
    })

  releases
    .command('delete <releaseId>')
    .description('Delete a draft (published releases cannot be deleted)')
    .option('--yes', 'Confirm the delete')
    .action(async (releaseId: string, opts: { yes?: boolean }) => {
      const id = requireUuid(releaseId, 'release id')
      requireYes(opts.yes, `This deletes draft release ${id}.`)
      const config = requireConfig()
      const result = await apiCall<unknown>(`/v1/admin/releases/${id}`, config, { method: 'DELETE' })
      if (!result.ok) die(result)
      console.log(`Deleted draft ${id}.`)
    })

  releases
    .command('publish <releaseId>')
    .description('Publish a draft: resolves its fixed reports and messages each credited reporter')
    .option('--yes', 'Confirm: reporters are messaged (or held for review)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (releaseId: string, opts: { yes?: boolean; json?: boolean }) => {
      const id = requireUuid(releaseId, 'release id')
      requireYes(opts.yes, `Publishing ${id} tells every credited reporter their fix shipped.`)
      const config = requireConfig()
      const result = await apiCall<ReleaseRow>(`/v1/admin/releases/${id}/publish`, config, { method: 'POST', body: '{}' }, { timeoutMs: PUBLISH_TIMEOUT_MS })
      if (!result.ok) die(result)
      const extra = result as ApiOk<ReleaseRow> & { delivery?: ReleaseDelivery; notified?: number; tickets_fulfilled?: number }
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify({ release: extra.data, notified: extra.notified, tickets_fulfilled: extra.tickets_fulfilled, delivery: extra.delivery }, null, 2))
        return
      }
      for (const line of renderPublish(extra.data, extra.delivery, extra.tickets_fulfilled)) console.log(line)
    })

  releases
    .command('calendar')
    .description('What is waiting to ship in each app, and one suggested batch (needs an account-level key)')
    .option('--org <id>', 'Organization UUID (default: your only organization)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { org?: string; json?: boolean }) => {
      const config = requireConfig()
      const result = await apiCall<ReleaseCalendarData>(`/v1/admin/orgs/${orgSegment(opts.org)}/releases`, config)
      if (!result.ok) dieOrgError(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      for (const line of renderCalendar(result.data)) console.log(line)
    })
}
