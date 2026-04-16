import { Command } from 'commander'
import { loadConfig, saveConfig } from './config.js'
import type { CliConfig } from './config.js'

async function apiCall(path: string, config: CliConfig, options: RequestInit = {}): Promise<unknown> {
  const endpoint = config.endpoint ?? 'https://api.mushimushi.dev'
  const res = await fetch(`${endpoint}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      ...options.headers,
    },
  })
  return res.json()
}

const program = new Command()
  .name('mushi')
  .description('Mushi Mushi CLI — manage bug reports and pipeline')
  .version('0.0.1')

program
  .command('login')
  .description('Store API key for authentication')
  .requiredOption('--api-key <key>', 'API key')
  .option('--endpoint <url>', 'API endpoint URL')
  .option('--project-id <id>', 'Default project ID')
  .action((opts) => {
    const config = loadConfig()
    config.apiKey = opts.apiKey
    if (opts.endpoint) config.endpoint = opts.endpoint
    if (opts.projectId) config.projectId = opts.projectId
    saveConfig(config)
    console.log('Saved credentials to ~/.mushirc')
  })

program
  .command('status')
  .description('Show project stats')
  .action(async () => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(1) }
    const data = await apiCall('/v1/admin/stats', config) as Record<string, unknown>
    console.log(JSON.stringify(data, null, 2))
  })

const reports = program.command('reports').description('Manage bug reports')

reports
  .command('list')
  .description('List recent reports')
  .option('--limit <n>', 'Max results', '20')
  .option('--status <status>', 'Filter by status')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(1) }
    const params = new URLSearchParams()
    params.set('limit', opts.limit)
    if (opts.status) params.set('status', opts.status)
    const data = await apiCall(`/v1/admin/reports?${params}`, config) as Record<string, unknown>
    if (opts.json) {
      console.log(JSON.stringify(data, null, 2))
    } else {
      const reports = ((data as Record<string, unknown>).data as Record<string, unknown>)?.reports as Record<string, unknown>[] ?? []
      for (const r of reports) {
        console.log(`${r.id}  ${r.severity ?? 'unset'}  ${r.status ?? 'new'}  ${(r.summary as string ?? '').slice(0, 60)}`)
      }
    }
  })

reports
  .command('show <id>')
  .description('Show report details')
  .action(async (id) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(1) }
    const data = await apiCall(`/v1/admin/reports/${id}`, config) as Record<string, unknown>
    console.log(JSON.stringify(data, null, 2))
  })

reports
  .command('triage <id>')
  .description('Update report status/severity')
  .option('--status <status>', 'New status')
  .option('--severity <severity>', 'New severity')
  .action(async (id, opts) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(1) }
    const body: Record<string, string> = {}
    if (opts.status) body.status = opts.status
    if (opts.severity) body.severity = opts.severity
    const data = await apiCall(`/v1/admin/reports/${id}`, config, { method: 'PATCH', body: JSON.stringify(body) }) as Record<string, unknown>
    console.log(JSON.stringify(data, null, 2))
  })

program
  .command('config')
  .description('View or update CLI config')
  .argument('[key]', 'Config key to set')
  .argument('[value]', 'Value')
  .action((key, value) => {
    const config = loadConfig()
    if (key && value) {
      ;(config as Record<string, unknown>)[key] = value
      saveConfig(config)
      console.log(`Set ${key} = ${value}`)
    } else {
      console.log(JSON.stringify(config, null, 2))
    }
  })

const deploy = program.command('deploy').description('Deployment management')

deploy
  .command('check')
  .description('Check edge function health')
  .action(async () => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(1) }
    const endpoint = config.endpoint ?? 'https://api.mushimushi.dev'
    try {
      const res = await fetch(`${endpoint}/v1/health`)
      console.log(`Health: ${res.status === 200 ? 'OK' : 'FAIL'} (${res.status})`)
    } catch (err) {
      console.error('Failed:', err)
    }
  })

program
  .command('test')
  .description('Submit a test report to verify pipeline')
  .action(async () => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(1) }
    const data = await apiCall('/v1/reports', config, {
      method: 'POST',
      headers: { 'X-Mushi-Api-Key': config.apiKey ?? '' },
      body: JSON.stringify({
        projectId: config.projectId,
        description: 'CLI test report — verifying pipeline',
        category: 'other',
        environment: { url: 'cli://test', browser: 'mushi-cli' },
      }),
    }) as Record<string, unknown>
    console.log('Test report submitted:', JSON.stringify(data, null, 2))
  })

program.parse()
