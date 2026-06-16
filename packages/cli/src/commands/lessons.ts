import type { Command } from 'commander';
import { apiCall, die, requireConfig, fmtDate, pad } from '../cli-shared.js';
import type { LessonRow, LessonListData, LessonsJson } from '../cli-types.js';

export function registerLessonsCommands(program: Command): void {
// ─── lessons ─────────────────────────────────────────────────────────────────
const lessons = program.command('lessons').description('Manage learned mistake rules')

lessons
  .command('list')
  .description('List active lessons (mistake rules) for the current project')
  .option('--severity <sev>', 'Filter: info|warn|critical')
  .option('--limit <n>', 'Max results (1–200)', '50')
  .option('--json', 'Machine-readable JSON output')
  .addHelpText('after', `
Lessons are mistake rules extracted from past bug reports by the clustering
pipeline. They are injected into AI code-review context via the MCP server.`)
  .action(async (opts: { severity?: string; limit: string; json?: boolean }) => {
    const config = requireConfig()
    const limit = Math.min(Math.max(1, parseInt(opts.limit) || 50), 200)
    const params = new URLSearchParams({ limit: String(limit) })
    if (opts.severity) params.set('severity', opts.severity)
    const result = await apiCall<LessonListData>(`/v1/sync/lessons?${params}`, config)
    if (!result.ok) die(result)
    if (opts.json) {
      console.log(JSON.stringify(result.data, null, 2))
      return
    }
    const rows = result.data
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log('No active lessons yet. Reports are clustered nightly.')
      return
    }
    console.log(`${pad('SEV', 9)} ${pad('FREQ', 6)} RULE`)
    console.log('─'.repeat(90))
    for (const l of rows as LessonRow[]) {
      const sev = l.severity ?? 'info'
      const freq = String(l.frequency ?? 0)
      const rule = (l.rule_text ?? '').slice(0, 70)
      console.log(`${pad(sev, 9)} ${pad(freq, 6)} ${rule}`)
    }
    console.log(`\n  ${rows.length} active lesson${rows.length === 1 ? '' : 's'}`)
  })

lessons
  .command('show <id>')
  .description('Show full detail for a single lesson (rule text, anti-pattern, source reports)')
  .option('--json', 'Machine-readable JSON output')
  .action(async (id: string, opts: { json?: boolean }) => {
    const config = requireConfig()
    const result = await apiCall<LessonRow>(`/v1/sync/lessons/${id}`, config)
    if (!result.ok) {
      if (result.httpStatus === 404 || result.error.code === 'NOT_FOUND') {
        process.stderr.write(`error: lesson "${id}" not found\n`)
        process.exit(3)
      }
      die(result)
    }
    if (opts.json) {
      console.log(JSON.stringify(result.data, null, 2))
      return
    }
    const l = result.data
    console.log(`Lesson: ${l.id}`)
    console.log(`  Severity:  ${l.severity}`)
    console.log(`  Frequency: ${l.frequency} reports`)
    if (l.last_reinforced_at) console.log(`  Updated:   ${fmtDate(l.last_reinforced_at)}`)
    console.log('')
    console.log(`Rule:`)
    console.log(`  ${l.rule_text}`)
    if (l.anti_pattern) {
      console.log('')
      console.log(`Anti-pattern:`)
      console.log(`  ${l.anti_pattern}`)
    }
    if (l.summary_paragraph) {
      console.log('')
      console.log(`Summary:`)
      console.log(`  ${l.summary_paragraph}`)
    }
  })

// ─── sync-lessons ─────────────────────────────────────────────────────────────
program
  .command('sync-lessons')
  .description('Pull promoted lessons from Mushi and write .mushi/lessons.json into this repo')
  .option('--cwd <path>', 'Target directory (default: current working dir)')
  .option('--dry-run', 'Print the JSON that would be written without writing anything')
  .option('--json', 'Machine-readable output: { ok, path, count }')
  .addHelpText('after', `
Used in CI to keep .mushi/lessons.json up to date so the Mushi MCP server
and Cursor rules can inject the latest project-specific mistake rules into
AI code review context.

Typical CI usage:
  MUSHI_API_KEY=$KEY MUSHI_PROJECT_ID=$PID MUSHI_API_ENDPOINT=$URL \\
    npx @mushi-mushi/cli sync-lessons --cwd .`)
  .action(async (opts: { cwd?: string; dryRun?: boolean; json?: boolean }) => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    const nodePath = await import('node:path')

    const config = requireConfig()

    const cwd = opts.cwd ?? process.cwd()
    const target = nodePath.join(cwd, '.mushi', 'lessons.json')

    const result = await apiCall<LessonRow[]>('/v1/sync/lessons?limit=500', config)
    if (!result.ok) die(result)

    const rows = Array.isArray(result.data) ? result.data : []
    const lessons: LessonsJson['lessons'] = rows.map((l) => ({
      id: l.id,
      rule: l.rule_text,
      anti_pattern: l.anti_pattern ?? undefined,
      severity: l.severity,
      frequency: l.frequency,
      last_reinforced: l.last_reinforced_at?.slice(0, 10) ?? '',
      cluster_id: l.cluster_id ?? undefined,
    }))

    const output: LessonsJson = {
      schema_version: '1',
      project_id: config.projectId ?? '',
      generated_at: new Date().toISOString(),
      lessons,
    }

    if (opts.dryRun) {
      console.log(JSON.stringify(output, null, 2))
      return
    }

    await mkdir(nodePath.dirname(target), { recursive: true })
    await writeFile(target, JSON.stringify(output, null, 2) + '\n', 'utf8')

    if (opts.json) {
      console.log(JSON.stringify({ ok: true, path: target, count: lessons.length }))
    } else {
      console.log(`✓ Wrote ${lessons.length} lesson${lessons.length === 1 ? '' : 's'} to ${target}`)
    }
  })

}
