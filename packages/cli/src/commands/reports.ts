import type { Command } from 'commander';
import { apiCall, die, requireConfig, fmtDate, pad, outputIsJson, printResult } from '../cli-shared.js';
import type { ReportListData, ReportDetail } from '../cli-types.js';
import { resolveProjectId } from '../command-helpers.js';
import { MushiCliError } from '../errors.js';

/** The severities `reports file` accepts (the server checks the same set). */
const FILE_REPORT_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

interface FileReportFlags {
  title?: string;
  description?: string;
  severity?: string;
  component?: string;
}

/** The POST /v1/admin/projects/:id/reports body, validated with the server's bounds before any call. */
function buildFileReportBody(flags: FileReportFlags): Record<string, string> {
  const title = (flags.title ?? '').trim();
  const description = (flags.description ?? '').trim();
  if (title.length < 3 || title.length > 200) {
    throw new MushiCliError('E_INVALID_INPUT', '--title must be 3 to 200 characters.');
  }
  if (description.length < 1 || description.length > 10_000) {
    throw new MushiCliError('E_INVALID_INPUT', '--description must be 1 to 10000 characters.');
  }
  const body: Record<string, string> = { title, description };
  if (flags.severity !== undefined) {
    const severity = flags.severity.trim().toLowerCase();
    if (!(FILE_REPORT_SEVERITIES as readonly string[]).includes(severity)) {
      throw new MushiCliError('E_INVALID_INPUT', `--severity must be one of: ${FILE_REPORT_SEVERITIES.join(', ')}.`);
    }
    body['severity'] = severity;
  }
  if (flags.component !== undefined) {
    const component = flags.component.trim();
    if (component.length > 200) throw new MushiCliError('E_INVALID_INPUT', '--component is at most 200 characters.');
    if (component) body['component'] = component;
  }
  return body;
}

interface FiledReport {
  reportId: string;
  projectId: string;
  title: string;
  status: string;
  severity: string | null;
  component: string | null;
}

export function registerReportsCommands(program: Command): void {
// ─── reports ──────────────────────────────────────────────────────────────────
const reports = program.command('reports').description('Manage bug reports')

reports
  .command('list')
  .description('List recent reports for the current project')
  .option('--limit <n>', 'Max results (1–100)', '20')
  .option('--status <status>', 'Filter by status: new|triaged|in_progress|resolved|dismissed')
  .option('--severity <severity>', 'Filter by severity: critical|high|medium|low')
  .option('--search <query>', 'Full-text search in summary and description')
  .option('--json', 'Output as JSON (alias for -o json)')
  .addHelpText('after', `
Examples:
  mushi reports list
  mushi reports list --status new --severity critical
  mushi reports list --search "button not working" --limit 5 --json`)
  .action(async (opts: { limit: string; status?: string; severity?: string; search?: string; json?: boolean }) => {
    const config = requireConfig()
    const limit = Math.min(Math.max(1, parseInt(opts.limit) || 20), 100)
    const params = new URLSearchParams({ limit: String(limit) })
    if (opts.status) params.set('status', opts.status)
    if (opts.severity) params.set('severity', opts.severity)
    if (opts.search) params.set('search', opts.search)
    const result = await apiCall<ReportListData>(`/v1/sync/reports?${params}`, config)
    if (!result.ok) die(result)
    printResult(result.data, {
      json: opts.json,
      render(d) {
        const rows = d.reports
        if (rows.length === 0) { console.log('No reports found.'); return }
        console.log(`${pad('ID', 38)} ${pad('SEV', 9)} ${pad('STATUS', 12)} ${pad('CREATED', 17)} SUMMARY`)
        console.log('─'.repeat(110))
        for (const r of rows) {
          const sev = r.severity ?? 'unset'
          const status = r.status ?? 'new'
          const summary = (r.summary ?? r.description ?? '').slice(0, 50)
          console.log(`${pad(r.id, 38)} ${pad(sev, 9)} ${pad(status, 12)} ${pad(fmtDate(r.created_at), 17)} ${summary}`)
        }
        if (d.total > rows.length) console.log(`\n  … ${d.total - rows.length} more. Use --limit to see more.`)
      },
    })
  })

reports
  .command('thread <id>')
  .description('Show unified timeline for a report (comments, fixes, QA, pipelines)')
  .option('--json', 'Output as JSON (alias for -o json)')
  .option('--watch', 'Poll for new timeline entries (TTY only)')
  .action(async (id: string, opts: { json?: boolean; watch?: boolean }) => {
    const config = requireConfig()
    const fetchTimeline = async () => {
      const result = await apiCall<{ report_id: string; timeline: Array<{
        id: string; lane: string; at: string; title: string; body?: string; status?: string
      }> }>(`/v1/sync/reports/${id}/timeline`, config)
      if (!result.ok) {
        if (result.httpStatus === 404 || result.error.code === 'NOT_FOUND') {
          process.stderr.write(`error: report "${id}" not found\n`)
          process.exit(3)
        }
        die(result)
      }
      return result.data
    }

    const render = (data: Awaited<ReturnType<typeof fetchTimeline>>) => {
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(data, null, 2))
        return
      }
      console.log(`Timeline for ${data.report_id}`)
      console.log('─'.repeat(72))
      for (const e of data.timeline) {
        console.log(`${fmtDate(e.at)}  [${e.lane}] ${e.title}${e.status ? ` (${e.status})` : ''}`)
        if (e.body) console.log(`    ${e.body.replace(/\n/g, '\n    ')}`)
      }
    }

    if (opts.watch && process.stdout.isTTY) {
      let lastLen = -1
      for (;;) {
        const data = await fetchTimeline()
        if (data.timeline.length !== lastLen) {
          console.clear()
          render(data)
          lastLen = data.timeline.length
        }
        await new Promise((r) => setTimeout(r, 3000))
      }
    }

    render(await fetchTimeline())
  })

reports
  .command('show <id>')
  .description('Show full details for a single report')
  .option('--json', 'Output as JSON (alias for -o json)')
  .action(async (id: string, opts: { json?: boolean }) => {
    const config = requireConfig()
    const result = await apiCall<ReportDetail>(`/v1/sync/reports/${id}`, config)
    if (!result.ok) {
      if (result.httpStatus === 404 || result.error.code === 'NOT_FOUND') {
        process.stderr.write(`error: report "${id}" not found\n`)
        process.exit(3)
      }
      die(result)
    }
    printResult(result.data, {
      json: opts.json,
      render(r) {
        console.log(`Report: ${r.id}`)
        console.log(`  Status:   ${r.status ?? 'new'}`)
        console.log(`  Severity: ${r.severity ?? 'unset'}`)
        console.log(`  Category: ${r.category ?? '—'}`)
        console.log(`  Created:  ${fmtDate(r.created_at)}`)
        if (r.summary) console.log(`  Summary:  ${r.summary}`)
        if (r.description) {
          console.log(`  Description:`)
          console.log(`    ${r.description.replace(/\n/g, '\n    ')}`)
        }
        if (r.environment?.url) console.log(`  URL:      ${r.environment.url}`)
        if (r.component) console.log(`  Component: ${r.component}`)
        if (r.sentry_event_id) console.log(`  Sentry:   ${r.sentry_event_id}`)
        if (r.fix_id) console.log(`  Fix:      ${r.fix_id}`)
        if (r.tags && Object.keys(r.tags).length > 0) console.log(`  Tags:     ${JSON.stringify(r.tags)}`)
      },
    })
  })

reports
  .command('triage <id>')
  .description('Update the status and/or severity of a report')
  .option('--status <status>', 'New status: new|triaged|in_progress|resolved|dismissed')
  .option('--severity <severity>', 'New severity: critical|high|medium|low')
  .option('--note <text>', 'Internal triage note')
  .option('--json', 'Output as JSON (alias for -o json)')
  .addHelpText('after', `
Examples:
  mushi reports triage <id> --status triaged --severity high
  mushi reports triage <id> --status in_progress --note "assigned to @alice"`)
  .action(async (id: string, opts: { status?: string; severity?: string; note?: string; json?: boolean }) => {
    const config = requireConfig()
    const body: Record<string, string> = {}
    if (opts.status) body['status'] = opts.status
    if (opts.severity) body['severity'] = opts.severity
    if (opts.note) body['note'] = opts.note
    if (Object.keys(body).length === 0) {
      process.stderr.write('error: provide at least one of --status, --severity, or --note\n')
      process.exit(2)
    }
    const result = await apiCall<ReportDetail>(`/v1/sync/reports/${id}`, config, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    if (!result.ok) {
      if (result.httpStatus === 404 || result.error.code === 'NOT_FOUND') {
        process.stderr.write(`error: report "${id}" not found\n`)
        process.exit(3)
      }
      die(result)
    }
    printResult(result.data, {
      json: opts.json,
      render() {
        console.log(`✓ Updated report ${id}`)
        if (opts.status) console.log(`  Status:   ${opts.status}`)
        if (opts.severity) console.log(`  Severity: ${opts.severity}`)
        if (opts.note) console.log(`  Note:     ${opts.note}`)
      },
    })
  })

reports
  .command('resolve <id>')
  .description('Mark a report as resolved (shorthand for triage --status resolved)')
  .option('--note <text>', 'Resolution note')
  .option('--json', 'Output as JSON (alias for -o json)')
  .action(async (id: string, opts: { note?: string; json?: boolean }) => {
    const config = requireConfig()
    const body: Record<string, string> = { status: 'resolved' }
    if (opts.note) body['note'] = opts.note
    const result = await apiCall<ReportDetail>(`/v1/sync/reports/${id}`, config, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    if (!result.ok) {
      if (result.httpStatus === 404 || result.error.code === 'NOT_FOUND') {
        process.stderr.write(`error: report "${id}" not found\n`)
        process.exit(3)
      }
      die(result)
    }
    printResult(result.data, {
      json: opts.json,
      render() {
        console.log(`✓ Resolved report ${id}`)
        if (opts.note) console.log(`  Note: ${opts.note}`)
      },
    })
  })

reports
  .command('reopen <id>')
  .description('Reopen a resolved or dismissed report')
  .option('--note <text>', 'Note explaining the reopen')
  .option('--json', 'Output as JSON (alias for -o json)')
  .action(async (id: string, opts: { note?: string; json?: boolean }) => {
    const config = requireConfig()
    const body: Record<string, string> = { status: 'reopened' }
    if (opts.note) body['note'] = opts.note
    const result = await apiCall<ReportDetail>(`/v1/sync/reports/${id}`, config, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    if (!result.ok) {
      if (result.httpStatus === 404 || result.error.code === 'NOT_FOUND') {
        process.stderr.write(`error: report "${id}" not found\n`)
        process.exit(3)
      }
      die(result)
    }
    printResult(result.data, {
      json: opts.json,
      render() { console.log(`✓ Reopened report ${id}`) },
    })
  })

reports
  .command('verify <id>')
  .description('Mark a fixed report as verified by the reporter (operator shortcut)')
  .option('--note <text>', 'Optional audit note')
  .option('--json', 'Output as JSON (alias for -o json)')
  .action(async (id: string, opts: { note?: string; json?: boolean }) => {
    const config = requireConfig()
    const body: Record<string, string> = { status: 'verified' }
    if (opts.note) body['note'] = opts.note
    const result = await apiCall<ReportDetail>(`/v1/sync/reports/${id}`, config, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    if (!result.ok) die(result)
    printResult(result.data, {
      json: opts.json,
      render() { console.log(`✓ Verified report ${id}`) },
    })
  })

reports
  .command('dismiss <id>')
  .description('Dismiss a report (not a real bug / out of scope)')
  .option('--note <text>', 'Reason for dismissal')
  .option('--json', 'Output as JSON (alias for -o json)')
  .action(async (id: string, opts: { note?: string; json?: boolean }) => {
    const config = requireConfig()
    const body: Record<string, string> = { status: 'dismissed' }
    if (opts.note) body['note'] = opts.note
    const result = await apiCall<ReportDetail>(`/v1/sync/reports/${id}`, config, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    if (!result.ok) {
      if (result.httpStatus === 404 || result.error.code === 'NOT_FOUND') {
        process.stderr.write(`error: report "${id}" not found\n`)
        process.exit(3)
      }
      die(result)
    }
    printResult(result.data, {
      json: opts.json,
      render() { console.log(`✓ Dismissed report ${id}`) },
    })
  })

reports
  .command('reply <id> <message>')
  .description('Send a visible reply to the reporter widget for a report')
  .option('--author <name>', 'Display name for the sender (default: "Mushi Admin")')
  .option('--json', 'Output as JSON (alias for -o json)')
  .addHelpText('after', `
Examples:
  mushi reports reply abc123 "Thanks for reporting — fixing this in the next release."
  mushi reports reply abc123 "Can you share a screenshot?" --author "Alice"`)
  .action(async (id: string, message: string, opts: { author?: string; json?: boolean }) => {
    const config = requireConfig()
    const body: Record<string, string> = { message }
    if (opts.author) body['author_name'] = opts.author
    const result = await apiCall<{ comment: unknown }>(`/v1/sync/reports/${id}/reply`, config, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    if (!result.ok) {
      if (result.httpStatus === 404 || result.error.code === 'NOT_FOUND') {
        process.stderr.write(`error: report "${id}" not found\n`)
        process.exit(3)
      }
      die(result)
    }
    printResult(result.data, {
      json: opts.json,
      render() { console.log(`✓ Reply sent to reporter for report ${id}`) },
    })
  })

reports
  .command('search <query>')
  .description('Search reports by keyword in summary and description')
  .option('--limit <n>', 'Max results (1–50)', '10')
  .option('--status <status>', 'Filter by status')
  .option('--json', 'Output as JSON (alias for -o json)')
  .addHelpText('after', `
Examples:
  mushi reports search "login button"
  mushi reports search "404 error" --status new --limit 20`)
  .action(async (query: string, opts: { limit: string; status?: string; json?: boolean }) => {
    const config = requireConfig()
    const limit = Math.min(Math.max(1, parseInt(opts.limit) || 10), 50)
    const params = new URLSearchParams({ search: query, limit: String(limit) })
    if (opts.status) params.set('status', opts.status)
    const result = await apiCall<ReportListData>(`/v1/sync/reports?${params}`, config)
    if (!result.ok) die(result)
    printResult(result.data, {
      json: opts.json,
      render(d) {
        const rows = d.reports
        if (rows.length === 0) { console.log(`No reports matching "${query}".`); return }
        console.log(`${rows.length} result${rows.length === 1 ? '' : 's'} for "${query}":`)
        console.log('')
        for (const r of rows) {
          console.log(`  ${r.id}`)
          console.log(`    ${r.severity ?? 'unset'} · ${r.status ?? 'new'} · ${fmtDate(r.created_at)}`)
          const text = r.summary ?? r.description ?? ''
          if (text) console.log(`    ${text.slice(0, 80)}`)
          console.log('')
        }
      },
    })
  })


reports
  .command('file')
  .description('File a report by hand (a backlog item, a bug you found yourself); it is triaged like any other report')
  .requiredOption('--title <text>', 'One-line title (3-200 characters)')
  .requiredOption('--description <text>', 'What happens, steps, what you expected (up to 10000 characters)')
  .option('--severity <severity>', 'Your hint: critical|high|medium|low (triage may refine it)')
  .option('--component <name>', 'Area of the app, e.g. checkout')
  .option('--project <id>', 'Project ID (defaults to the configured project)')
  .option('--project-id <id>', 'Same as --project')
  .option('--json', 'Output as JSON (alias for -o json)')
  .addHelpText('after', `
Needs a key with the mcp:write scope (or an account key that reaches the app).
At most 30 reports an hour per app.

Examples:
  mushi reports file --title "Checkout adds tax twice" --description "Cart of 2 items shows tax x2 on /checkout"
  mushi reports file --title "Bump sharp to 0.34" --description "..." --severity low --component build --project <uuid>`)
  .action(async (opts: FileReportFlags & { project?: string; projectId?: string; json?: boolean }) => {
    const body = buildFileReportBody(opts)
    const config = requireConfig()
    const projectId = resolveProjectId(opts.project ?? opts.projectId, config.projectId)
    const result = await apiCall<FiledReport>(`/v1/admin/projects/${projectId}/reports`, config, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    if (!result.ok) die(result)
    printResult(result.data, {
      json: opts.json,
      render(d) {
        console.log(`✓ Filed report ${d.reportId}`)
        console.log(`  ${d.title}`)
        console.log(`  Triage runs now; see it with: mushi reports show ${d.reportId}`)
      },
    })
  })

}
