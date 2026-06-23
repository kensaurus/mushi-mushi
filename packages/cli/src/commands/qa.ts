import type { Command } from 'commander';
import { loadConfig } from '../config.js';
import { apiCall } from '../cli-shared.js';
import { resolveConsoleUrlSync } from '../console-url.js';
import type { QaStoryRow, QaRunRow } from '../cli-types.js';

export function registerQaCommands(program: Command): void {
// ─── qa ───────────────────────────────────────────────────────────────────────

const qa = program.command('qa').description('QA story management')

qa
  .command('stories')
  .description('List QA stories for the current project')
  .option('--json', 'Machine-readable output')
  .option('-n, --limit <n>', 'Max stories to return (not applied server-side; all stories returned)', '20')
  .action(async (opts: { json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(2) }
    if (!config.projectId) { console.error('No projectId. Run `mushi config projectId <uuid>`'); process.exit(2) }
    const result = await apiCall<{ coverage: QaStoryRow[] }>(
      `/v1/admin/projects/${config.projectId}/qa-coverage`,
      config,
    )
    if (!result.ok) { console.error('Failed:', result.error); process.exit(1) }
    if (opts.json) { console.log(JSON.stringify(result.data, null, 2)); return }
    const stories = result.data?.coverage ?? []
    if (stories.length === 0) {
      console.log('No QA stories yet. Create one at /qa-coverage in the Mushi console.')
      return
    }
    console.log(`\nQA Stories (${stories.length}):\n`)
    for (const s of stories) {
      const statusIcon = s.last_run_status === 'passed' ? 'PASS'
        : s.last_run_status === 'failed' ? 'FAIL'
        : s.last_run_status === 'error' ? 'ERROR'
        : 'SKIP'
      const enabled = s.enabled ? '' : ' [disabled]'
      const sid = s.story_id ?? s.id ?? '—'
      console.log(`  ${statusIcon}  ${s.name.slice(0, 50).padEnd(52)}  ${sid}${enabled}`)
    }
    console.log(`\n   Use 'mushi qa runs <storyId>' to see recent runs for a story.`)
    console.log()
  })

qa
  .command('runs <storyId>')
  .description('Show recent runs for a QA story, including error heads')
  .option('--json', 'Machine-readable output')
  .option('-n, --limit <n>', 'Max runs to return', '10')
  .action(async (storyId: string, opts: { json?: boolean; limit?: string }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(2) }
    if (!config.projectId) { console.error('No projectId. Run `mushi config projectId <uuid>`'); process.exit(2) }
    const limit = parseInt(opts.limit ?? '10', 10)
    const result = await apiCall<{ runs: QaRunRow[] }>(
      `/v1/admin/projects/${config.projectId}/qa-stories/${storyId}/runs?limit=${limit}`,
      config,
    )
    if (!result.ok) { console.error('Failed:', result.error); process.exit(1) }
    if (opts.json) { console.log(JSON.stringify(result.data, null, 2)); return }
    const runs = result.data?.runs ?? []
    if (runs.length === 0) {
      console.log('No runs yet for this story. Trigger one with `mushi qa run <storyId>`.')
      return
    }
    console.log(`\nRecent runs for story ${storyId.slice(0, 8)}…:\n`)
    for (const r of runs) {
      const statusIcon = r.status === 'passed' ? 'PASS' : r.status === 'failed' ? 'FAIL' : r.status === 'error' ? 'ERROR' : 'PEND'
      const ts = r.created_at ? new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' ') : '—'
      const latency = r.latency_ms ? ` (${(r.latency_ms / 1000).toFixed(1)}s)` : ''
      console.log(`  ${statusIcon}  ${ts}${latency}  ${r.id.slice(0, 8)}`)
      if (r.error_message) {
        console.log(`       Error: ${r.error_message.slice(0, 120)}`)
      }
      if (r.assertion_failures?.length) {
        for (const af of r.assertion_failures.slice(0, 3)) {
          console.log(`       · ${String(af).slice(0, 100)}`)
        }
      }
    }
    const consoleUrl = config.consoleUrl ?? resolveConsoleUrlSync()
    console.log(`\n   Open in console: ${consoleUrl}/qa-coverage?story=${storyId}`)
    console.log(`   Tip: run 'mushi config consoleUrl <url>' to override (e.g. http://localhost:6464 for local dev)`)
    console.log()
  })

qa
  .command('run <storyId>')
  .description('Manually trigger a QA story run (fire-and-forget; check results with `mushi qa runs <id>`)')
  .option('--json', 'Machine-readable output')
  .action(async (storyId: string, opts: { json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(2) }
    if (!config.projectId) { console.error('No projectId. Run `mushi config projectId <uuid>`'); process.exit(2) }
    const result = await apiCall<{ run_id: string; queued: boolean }>(
      `/v1/admin/projects/${config.projectId}/qa-stories/${storyId}/run`,
      config,
      { method: 'POST' },
    )
    if (!result.ok) { console.error('Failed:', result.error); process.exit(1) }
    if (opts.json) { console.log(JSON.stringify(result.data, null, 2)); return }
    const runId = result.data?.run_id
    if (runId) {
      console.log(`RUN  Triggered: ${runId.slice(0, 8)}…`)
      console.log(`     Check results: mushi qa runs ${storyId}`)
    } else {
      console.error('FAIL Trigger failed: no run_id in response', JSON.stringify(result.data))
      process.exit(1)
    }
  })

}
