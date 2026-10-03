/**
 * FILE: packages/cli/src/commands/sentry.ts
 * PURPOSE: `mushi sentry import` — pull existing Sentry issues into the report
 *          queue (POST /v1/admin/projects/:id/sentry/import). The webhook only
 *          sees new issues; this brings in the ones already open. Re-running
 *          is safe: an issue already imported links to its report.
 */

import type { Command } from 'commander'
import { apiCall, die, outputIsJson, requireConfig } from '../cli-shared.js'
import { resolveProjectId } from '../command-helpers.js'
import { MushiCliError } from '../errors.js'

/** The import reads up to ten issues and their latest events from Sentry. */
const IMPORT_TIMEOUT_MS = 90_000

interface SentryImportData {
  items: Array<{ input: string; issueId: string | null; shortId: string | null; outcome: string; reportId: string | null; error?: string }>
  created: string[]
  linked: string[]
  failed: number
  indexing: { queued: boolean; paths: number }
  sentryProject: string | null
  sentryProjects: string[]
  nextCursor: string | null
}

interface SentryImportFlags {
  query?: string
  limit?: string
  sinceDays?: string
  cursor?: string
  sentryProject?: string
}

/** Build the request body, validating the same bounds the server enforces. */
function buildSentryImportBody(issueIds: string[], flags: SentryImportFlags): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (issueIds.length > 0) {
    if (issueIds.length > 10) throw new MushiCliError('E_INVALID_INPUT', 'Import at most 10 issue ids at a time.')
    if (flags.query || flags.cursor || flags.sinceDays || flags.sentryProject) {
      throw new MushiCliError('E_INVALID_INPUT', 'Pass issue ids or a search (--query / --since-days / --cursor / --sentry-project), not both.')
    }
    body['issueIds'] = issueIds
  }
  if (flags.query) body['query'] = flags.query
  if (flags.limit !== undefined) {
    const n = Number(flags.limit)
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new MushiCliError('E_INVALID_INPUT', '--limit must be 1 to 10')
    body['limit'] = n
  }
  if (flags.sinceDays !== undefined) {
    const n = Number(flags.sinceDays)
    if (!Number.isInteger(n) || n < 1 || n > 90) throw new MushiCliError('E_INVALID_INPUT', '--since-days must be 1 to 90')
    body['sinceDays'] = n
  }
  if (flags.cursor) body['cursor'] = flags.cursor
  if (flags.sentryProject) body['sentryProject'] = flags.sentryProject
  return body
}

/** The same search, one page on: a cursor only makes sense with the flags that produced it. */
function nextPageCommand(flags: SentryImportFlags, cursor: string): string {
  const parts = ['mushi sentry import']
  if (flags.query) parts.push(`--query ${JSON.stringify(flags.query)}`)
  if (flags.sinceDays) parts.push(`--since-days ${flags.sinceDays}`)
  if (flags.limit) parts.push(`--limit ${flags.limit}`)
  if (flags.sentryProject) parts.push(`--sentry-project ${flags.sentryProject}`)
  parts.push(`--cursor ${cursor}`)
  return parts.join(' ')
}

function renderSentryImport(data: SentryImportData, flags: SentryImportFlags = {}): string[] {
  const lines = [`Sentry project: ${data.sentryProject ?? data.sentryProjects.join(', ')}`]
  if (data.items.length === 0) lines.push('  No matching issues.')
  for (const i of data.items) {
    const label = i.shortId ?? i.issueId ?? i.input
    const tail = i.reportId ? ` → report ${i.reportId}` : i.error ? ` — ${i.error}` : ''
    lines.push(`  ${i.outcome.toUpperCase().padEnd(10)} ${label}${tail}`)
  }
  lines.push(`New reports: ${data.created.length} · linked to existing: ${data.linked.length} · failed: ${data.failed}`)
  if (data.indexing.queued && data.indexing.paths > 0) lines.push(`Indexing ${data.indexing.paths} file(s) from the stack traces so the fix context can reach them.`)
  if (data.nextCursor) lines.push(`More issues: ${nextPageCommand(flags, data.nextCursor)}`)
  return lines
}

export function registerSentryCommands(program: Command): void {
  const sentry = program.command('sentry').description('Sentry issues in your Mushi queue')

  sentry
    .command('import [issueIds...]')
    .description('Import open Sentry issues as reports (by id, by search, or the newest unresolved)')
    .option('--query <q>', 'Sentry search, e.g. "is:unresolved level:error"')
    .option('--limit <n>', 'Issues per page, 1-10')
    .option('--since-days <n>', 'Only issues seen in the last N days (1-90)')
    .option('--cursor <cursor>', 'Next page, from the previous import')
    .option('--sentry-project <slug>', 'Which connected Sentry project (default: the primary)')
    .option('--project-id <id>', 'Mushi project ID (defaults to the configured project)')
    .option('--json', 'Machine-readable JSON output')
    .addHelpText('after', `
Needs the Sentry org slug, project slug and an auth token with event:read and
project:read (console: Integrations → Sentry). With no ids and no --query it
imports the newest unresolved issues.

Examples:
  mushi sentry import
  mushi sentry import PROJ-1A2 PROJ-1A3
  mushi sentry import --query "is:unresolved level:error" --since-days 7`)
    .action(async (issueIds: string[], opts: SentryImportFlags & { projectId?: string; json?: boolean }) => {
      const body = buildSentryImportBody(issueIds, opts)
      const config = requireConfig()
      const projectId = resolveProjectId(opts.projectId, config.projectId)
      const result = await apiCall<SentryImportData>(
        `/v1/admin/projects/${projectId}/sentry/import`,
        config,
        { method: 'POST', body: JSON.stringify(body) },
        { timeoutMs: IMPORT_TIMEOUT_MS },
      )
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      for (const line of renderSentryImport(result.data, opts)) console.log(line)
      if (result.data.failed > 0) process.exitCode = 1
    })
}
