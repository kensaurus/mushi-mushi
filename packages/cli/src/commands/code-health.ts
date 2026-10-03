/**
 * FILE: packages/cli/src/commands/code-health.ts
 * PURPOSE: `mushi code-health show|stats` — console parity for the Code
 *          Health page: oversized files from the latest `code_health` run and
 *          the bundle / file-size trend (GET /v1/admin/code-health,
 *          GET /v1/admin/code-health/stats). Data arrives from your CI through
 *          POST /v1/ingest/metrics.
 */

import type { Command } from 'commander'
import { apiCall, die, fmtDate, outputIsJson, requireConfig } from '../cli-shared.js'
import { oneLine, resolveProjectId } from '../command-helpers.js'

interface CodeHealthData {
  godFiles: Array<{ id: string; rule_id: string; severity: 'error' | 'warn' | 'info'; file_path: string | null; line: number | null; message: string }>
  latestRunAt: string | null
  latestRunStatus: string | null
  summary: { error_count: number; warn_count: number; max_loc: number | null; latest_bundle_kb: number | null }
}

interface CodeHealthStats {
  hasAnyProject: boolean
  projectName: string | null
  errorCount: number
  warnCount: number
  godFileCount: number
  hasRun: boolean
  latestRunAt: string | null
  topPriorityLabel: string | null
}

function renderCodeHealth(data: CodeHealthData): string[] {
  if (!data.latestRunAt) {
    return [
      'No code-health run yet. Post one from CI:',
      '  POST /v1/ingest/metrics with metrics[] (bundle.*, code_health.*) and findings[]',
    ]
  }
  const s = data.summary
  const lines = [
    `Latest run ${fmtDate(data.latestRunAt)} (${data.latestRunStatus ?? 'unknown'}): ${s.error_count} error(s), ${s.warn_count} warning(s)` +
      `${s.max_loc != null ? ` · largest file ${s.max_loc} lines` : ''}${s.latest_bundle_kb != null ? ` · bundle ${s.latest_bundle_kb} KB gzip` : ''}`,
  ]
  for (const f of data.godFiles) {
    const where = f.file_path ? `${f.file_path}${f.line ? `:${f.line}` : ''}` : '(no file)'
    lines.push(`  ${f.severity.toUpperCase().padEnd(5)} ${where}`)
    lines.push(`        ${oneLine(f.message, 110)}  [${f.id}]`)
  }
  if (data.godFiles.length > 0) lines.push('Explain one: mushi audit explain <finding id>')
  return lines
}

export function registerCodeHealthCommands(program: Command): void {
  const codeHealth = program
    .command('code-health')
    .description('Oversized files and bundle size from your CI (Code Health page)')

  codeHealth
    .command('show')
    .description('Findings from the latest code-health run and the size summary')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--days <n>', 'Trend window in days (1-365)', '30')
    .option('--json', 'Machine-readable JSON output (includes the trend series)')
    .action(async (opts: { projectId?: string; days: string; json?: boolean }) => {
      const config = requireConfig()
      const projectId = resolveProjectId(opts.projectId, config.projectId)
      const qs = new URLSearchParams({ project_id: projectId, days: opts.days })
      const result = await apiCall<CodeHealthData>(`/v1/admin/code-health?${qs}`, config)
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      for (const line of renderCodeHealth(result.data)) console.log(line)
    })

  codeHealth
    .command('stats')
    .description('Counts only: errors, warnings and oversized files')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { projectId?: string; json?: boolean }) => {
      const config = requireConfig()
      const projectId = resolveProjectId(opts.projectId, config.projectId)
      const result = await apiCall<CodeHealthStats>(
        `/v1/admin/code-health/stats?${new URLSearchParams({ project_id: projectId })}`,
        config,
      )
      if (!result.ok) die(result)
      const d = result.data
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(d, null, 2))
        return
      }
      if (!d.hasRun) {
        console.log('No code-health run yet.')
        return
      }
      console.log(`${d.projectName ?? projectId}: ${d.errorCount} error(s), ${d.warnCount} warning(s), ${d.godFileCount} oversized file(s) · last run ${fmtDate(d.latestRunAt)}`)
      if (d.topPriorityLabel) console.log(`Next: ${d.topPriorityLabel}`)
    })
}
