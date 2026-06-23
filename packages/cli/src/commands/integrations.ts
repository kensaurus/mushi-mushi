import type { Command } from 'commander';
import { loadConfig } from '../config.js';
import { apiCall } from '../cli-shared.js';
import type { IntegrationListData, IntegrationProbeResult } from '../cli-types.js';

export function registerIntegrationsCommands(program: Command): void {
// ─── integrations ─────────────────────────────────────────────────────────────

const integrations = program.command('integrations').description('Manage service integrations')

integrations
  .command('list')
  .description('List all configured integrations and their current health status')
  .option('--json', 'Machine-readable output')
  .action(async (opts: { json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(2) }
    if (!config.projectId) { console.error('No projectId. Run `mushi config projectId <uuid>`'); process.exit(2) }
    const result = await apiCall<IntegrationListData>(
      `/v1/admin/projects/${config.projectId}/integrations`,
      config,
    )
    // Server returns { integrations: [...] } directly (no ok wrapper)
    const rawResult = result as unknown as Record<string, unknown>
    if (!rawResult.integrations && !result.ok) {
      console.error('Failed:', result.error); process.exit(1)
    }
    if (opts.json) { console.log(JSON.stringify(rawResult, null, 2)); return }
    const rows: IntegrationListData['integrations'] = (rawResult.integrations as IntegrationListData['integrations']) ?? []
    if (rows.length === 0) { console.log('No integrations configured. Visit the Integrations page to connect services.'); return }
    const icons: Record<string, string> = {
      slack: '🔔', github: '🐙', sentry: '🪲', langfuse: '🔭',
      discord: '💬', linear: '📐', jira: '🗂️', cursor_cloud: '🖱️', claude_code_agent: '🤖',
    }
    console.log('\nIntegrations:\n')
    for (const row of rows) {
      const icon = icons[row.kind] ?? '🔌'
      const statusIcon = row.status === 'ok' ? 'OK' : row.status === 'error' ? 'FAIL' : 'SKIP'
      console.log(`  ${icon}  ${row.kind.padEnd(20)} ${statusIcon}  ${row.detail ?? ''}`)
    }
    console.log()
  })

integrations
  .command('test <kind>')
  .description(
    'Run a health probe for a specific integration (e.g. slack, sentry, github, langfuse, discord, cursor_cloud, claude_code_agent)',
  )
  .option('--json', 'Machine-readable output')
  .action(async (kind: string, opts: { json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(2) }
    if (!config.projectId) { console.error('No projectId. Run `mushi config projectId <uuid>`'); process.exit(2) }
    const result = await apiCall<IntegrationProbeResult>(
      `/v1/admin/projects/${config.projectId}/integrations/probe/${kind}`,
      config,
      { method: 'POST' },
    )
    if (!result.ok) { console.error('Request failed:', result.error); process.exit(1) }
    if (opts.json) { console.log(JSON.stringify(result.data, null, 2)); return }
    const probeOk = result.data?.status === 'ok'
    console.log(probeOk
      ? `OK   ${kind} integration is healthy${result.data.detail ? ': ' + result.data.detail : ''}`
      : `FAIL ${kind} integration check failed${result.data.detail ? ': ' + result.data.detail : ''}`,
    )
    if (!probeOk) process.exit(1)
  })

// ─── slack ────────────────────────────────────────────────────────────────────

const slack = program.command('slack').description('Slack integration commands')

slack
  .command('status')
  .description('Show whether Slack is connected and which channel receives notifications')
  .option('--json', 'Machine-readable output')
  .action(async (opts: { json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(2) }
    if (!config.projectId) { console.error('No projectId. Run `mushi config projectId <uuid>`'); process.exit(2) }
    const result = await apiCall<IntegrationProbeResult>(
      `/v1/admin/projects/${config.projectId}/integrations/probe/slack`,
      config,
      { method: 'POST' },
    )
    if (!result.ok) { console.error('Request failed:', result.error); process.exit(1) }
    if (opts.json) { console.log(JSON.stringify(result.data, null, 2)); return }
    if (result.data?.status === 'ok') {
      console.log('OK   Slack connected')
      if (result.data.detail) console.log(`    ${result.data.detail}`)
      console.log('\n    To change the channel or notification prefs, visit /integrations in the Mushi console.')
    } else {
      console.log('SKIP Slack not connected')
      console.log('    Visit /integrations in the Mushi console and click "Add to Slack".')
    }
  })

slack
  .command('test')
  .description('Send a test Slack notification to confirm the current channel is working')
  .option('--json', 'Machine-readable output')
  .action(async (opts: { json?: boolean }) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(2) }
    if (!config.projectId) { console.error('No projectId. Run `mushi config projectId <uuid>`'); process.exit(2) }
    const result = await apiCall<{ ok: boolean; error?: string }>(
      `/v1/admin/projects/${config.projectId}/integrations/slack/test`,
      config,
      { method: 'POST' },
    )
    if (!result.ok) { console.error('Request failed:', result.error); process.exit(1) }
    if (opts.json) { console.log(JSON.stringify(result.data, null, 2)); return }
    if (result.data?.ok) {
      console.log('OK   Test message sent. Check your Slack channel.')
    } else {
      console.error('FAIL Test failed:', result.data?.error ?? 'unknown error')
      process.exit(1)
    }
  })

}
