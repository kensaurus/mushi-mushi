import type { Command } from 'commander';
import { apiCall, die, requireConfig, fmtDate, pad } from '../cli-shared.js';

export function registerFeedbackCommands(program: Command): void {
// ─── feedback ────────────────────────────────────────────────────────────────
const feedback = program.command('feedback').description('Community feedback board (bugs + feature requests)')

feedback
  .command('board')
  .description('List open feature requests and community tickets for the current project')
  .option('--limit <n>', 'Max results (1–50)', '20')
  .option('--json', 'Machine-readable JSON output')
  .addHelpText('after', `
Examples:
  mushi feedback board
  mushi feedback board --limit 10 --json`)
  .action(async (opts: { limit: string; json?: boolean }) => {
    const config = requireConfig()
    if (!config.projectId) {
      process.stderr.write('error: no projectId — run `mushi config projectId <uuid>`\n')
      process.exit(2)
    }
    const limit = Math.min(Math.max(1, parseInt(opts.limit) || 20), 50)
    // `/v1/admin/feature-board` accepts an operator API key (mcp:read) and
    // scopes to the key's project automatically. The legacy
    // `/v1/admin/support/tickets` route is console-JWT-only → always 401 here.
    const result = await apiCall<{ tickets: Array<{
      id: string
      subject: string
      status: string
      vote_count?: number
      created_at: string
    }> }>(
      `/v1/admin/feature-board`,
      config,
    )
    if (!result.ok) die(result)
    const rows = (result.data?.tickets ?? []).slice(0, limit)
    if (opts.json) {
      console.log(JSON.stringify(rows, null, 2))
      return
    }
    if (rows.length === 0) {
      console.log('No feature requests on the board yet.')
      return
    }
    console.log(`${pad('ID', 38)} ${pad('VOTES', 6)} ${pad('STATUS', 12)} ${pad('CREATED', 17)} SUBJECT`)
    console.log('─'.repeat(110))
    for (const t of rows) {
      console.log(`${pad(t.id, 38)} ${pad(String(t.vote_count ?? 0), 6)} ${pad(t.status, 12)} ${pad(fmtDate(t.created_at), 17)} ${(t.subject ?? '').slice(0, 40)}`)
    }
  })

}
