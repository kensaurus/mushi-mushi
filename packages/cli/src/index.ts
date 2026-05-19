import { Command } from 'commander'
import { loadConfig, saveConfig } from './config.js'
import type { CliConfig } from './config.js'
import { runInit } from './init.js'
import { runMigrate } from './migrate.js'
import type { FrameworkId } from './detect.js'
import { MUSHI_CLI_VERSION } from './version.js'
import { assertEndpoint } from './endpoint.js'
import { runSourcemapsUpload } from './sourcemaps.js'

async function apiCall(path: string, config: CliConfig, options: RequestInit = {}): Promise<unknown> {
  const endpoint = config.endpoint
  if (!endpoint) {
    throw new Error(
      'No API endpoint configured. Run `mushi init` or set MUSHI_API_ENDPOINT. ' +
        'Set endpoint to your Supabase edge function URL, e.g. https://xyz.supabase.co/functions/v1/api',
    )
  }
  const res = await fetch(`${endpoint}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'X-Mushi-Api-Key': config.apiKey ?? '',
      'X-Mushi-Project': config.projectId ?? '',
      ...options.headers,
    },
  })
  return res.json()
}

const program = new Command()
  .name('mushi')
  .description('Mushi Mushi CLI — set up the SDK, manage bug reports, monitor pipeline')
  .version(MUSHI_CLI_VERSION)

program
  .command('init')
  .description('Set up the Mushi Mushi SDK in this project (auto-detects framework)')
  .option('--project-id <id>', 'Skip the prompt by passing the project ID')
  .option('--api-key <key>', 'Skip the prompt by passing the API key')
  .option('--framework <id>', 'Force a framework (next, react, vue, nuxt, svelte, sveltekit, angular, expo, react-native, capacitor, vanilla)')
  .option('--skip-install', 'Don\'t auto-install the SDK package — print the command instead')
  .option('-y, --yes', 'Accept detected framework without prompting')
  .option('--cwd <path>', 'Run the wizard in a different directory')
  .option('--endpoint <url>', 'Override the Mushi API endpoint (self-hosted)')
  .option('--skip-test-report', 'Skip the end-of-wizard "send a test report" prompt')
  .action(async (opts: {
    projectId?: string
    apiKey?: string
    framework?: FrameworkId
    skipInstall?: boolean
    yes?: boolean
    cwd?: string
    endpoint?: string
    skipTestReport?: boolean
  }) => {
    await runInit({
      projectId: opts.projectId,
      apiKey: opts.apiKey,
      framework: opts.framework,
      skipInstall: opts.skipInstall,
      yes: opts.yes,
      cwd: opts.cwd,
      endpoint: opts.endpoint,
      sendTestReport: opts.skipTestReport ? false : undefined,
    })
  })

program
  .command('migrate')
  .description(
    'Suggest the most relevant Mushi Mushi migration guide based on your package.json',
  )
  .option('--cwd <path>', 'Run from a different directory')
  .option('--json', 'Machine-readable JSON output')
  .action((opts: { cwd?: string; json?: boolean }) => {
    const { matches } = runMigrate({ cwd: opts.cwd, json: opts.json })
    /* Non-zero exit when nothing matched so the command composes well in
     * shell scripts (`mushi migrate || echo "no suggestions"`). The
     * --json mode still respects this so CI gates can branch on it. */
    if (matches.length === 0) process.exit(1)
  })

program
  .command('login')
  .description('Store API key for authentication')
  .requiredOption('--api-key <key>', 'API key')
  .option('--endpoint <url>', 'API endpoint URL')
  .option('--project-id <id>', 'Default project ID')
  .action((opts) => {
    const config = loadConfig()
    config.apiKey = opts.apiKey
    if (opts.endpoint) config.endpoint = assertEndpoint(opts.endpoint)
    if (opts.projectId) config.projectId = opts.projectId
    saveConfig(config)
    console.log('Saved credentials to ~/.mushirc (mode 0o600)')
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
      const safeValue = key === 'endpoint' ? assertEndpoint(value) : value
      ;(config as Record<string, unknown>)[key] = safeValue
      saveConfig(config)
      console.log(`Set ${key} = ${safeValue}`)
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
    if (!config.endpoint) {
      console.error(
        'No API endpoint configured. Run `mushi init` or set MUSHI_API_ENDPOINT.\n' +
          'Set endpoint to your Supabase edge function URL, e.g. https://xyz.supabase.co/functions/v1/api',
      )
      process.exit(1)
    }
    const endpoint = config.endpoint
    try {
      const res = await fetch(`${endpoint}/health`)
      console.log(`Health: ${res.status === 200 ? 'OK' : 'FAIL'} (${res.status})`)
    } catch (err) {
      console.error('Failed:', err)
    }
  })

program
  .command('index <path>')
  .description('Walk a local repo and upload code chunks to the RAG indexer (non-GitHub fallback for V5.3 §2.3.4)')
  .option('--language <lang>', 'Limit to one language (ts, tsx, js, py, go, rs)')
  .option('--dry-run', 'Show what would be uploaded without sending')
  .action(async (path, opts) => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(1) }
    if (!config.projectId) { console.error('Set projectId via `mushi config projectId <id>`'); process.exit(1) }

    const { readdir, readFile, stat } = await import('node:fs/promises')
    const nodePath = await import('node:path')

    const SKIP = /node_modules|\.git|dist|build|\.next|\.turbo|coverage/
    const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'])

    async function* walk(dir: string): AsyncGenerator<string> {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        const full = nodePath.join(dir, e.name)
        if (SKIP.test(full)) continue
        if (e.isDirectory()) yield* walk(full)
        else if (EXTS.has(nodePath.extname(e.name))) yield full
      }
    }

    let count = 0
    let bytes = 0
    const root = nodePath.resolve(path)
    for await (const file of walk(root)) {
      const lang = nodePath.extname(file).slice(1)
      if (opts.language && opts.language !== lang) continue
      const stats = await stat(file)
      if (stats.size > 500_000) continue
      const source = await readFile(file, 'utf8')
      const relative = nodePath.relative(root, file).replaceAll('\\', '/')
      count++
      bytes += source.length
      if (opts.dryRun) {
        console.log(`  ${relative} (${source.length} bytes)`)
        continue
      }
      const res = await apiCall('/v1/admin/codebase/upload', config, {
        method: 'POST',
        body: JSON.stringify({
          projectId: config.projectId,
          filePath: relative,
          source,
        }),
      }) as { ok?: boolean; chunks?: number; error?: string }
      if (!res.ok) console.error(`  FAIL ${relative}: ${res.error ?? 'unknown'}`)
      else process.stdout.write(`  ${relative} → ${res.chunks ?? 0} chunks\n`)
    }
    console.log(`Indexed ${count} files (${(bytes / 1024).toFixed(1)} KB) into project ${config.projectId}`)
  })

program
  .command('test')
  .description('Submit a test report to verify pipeline')
  .action(async () => {
    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(1) }
    const data = await apiCall('/v1/reports', config, {
      method: 'POST',
      body: JSON.stringify({
        projectId: config.projectId,
        description: 'CLI test report — verifying pipeline',
        category: 'other',
        reporterToken: `cli-test-${Date.now()}`,
        createdAt: new Date().toISOString(),
        environment: {
          url: 'cli://test',
          userAgent: 'mushi-cli',
          platform: process.platform,
          language: 'en',
          viewport: { width: 0, height: 0 },
          referrer: '',
          timestamp: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      }),
    }) as Record<string, unknown>
    console.log('Test report submitted:', JSON.stringify(data, null, 2))
  })

const sourcemaps = program.command('sourcemaps').description('Source map management')

sourcemaps
  .command('upload')
  .description('Upload source map files to the Mushi platform (idempotent, sha256-keyed)')
  .requiredOption('--release <version>', 'Release version (e.g. 1.0.0 or git SHA)')
  .option('--dir <path>', 'Directory containing source maps', './dist')
  .option('--dry-run', 'List files that would be uploaded without uploading')
  .option('-e, --endpoint <url>', 'API endpoint (overrides MUSHI_API_ENDPOINT)')
  .option('--api-key <key>', 'API key (overrides MUSHI_API_KEY)')
  .option('--silent', 'Suppress progress output (exit code still reflects failure)')
  .action(async (opts: {
    release: string
    dir: string
    dryRun?: boolean
    endpoint?: string
    apiKey?: string
    silent?: boolean
  }) => {
    await runSourcemapsUpload({
      release: opts.release,
      dir: opts.dir,
      dryRun: opts.dryRun,
      endpoint: opts.endpoint,
      apiKey: opts.apiKey,
      silent: opts.silent,
    })
  })

// ─── sync-lessons command ────────────────────────────────────────────────────
// Pulls promoted lessons from the Mushi API and writes .mushi/lessons.json
// into the current repo. Designed to be called from CI or mushi-cron.

program
  .command('sync-lessons')
  .description('Sync promoted lessons from Mushi into .mushi/lessons.json in this repo')
  .option('--cwd <path>', 'Target directory (default: current working dir)')
  .option('--dry-run', 'Print what would be written without writing')
  .option('--json', 'Machine-readable JSON output')
  .action(async (opts: { cwd?: string; dryRun?: boolean; json?: boolean }) => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    const nodePath = await import('node:path')

    const config = loadConfig()
    if (!config.apiKey) { console.error('Run `mushi login` first'); process.exit(1) }
    if (!config.projectId) { console.error('Set projectId via `mushi config projectId <id>`'); process.exit(1) }

    const cwd = opts.cwd ?? process.cwd()
    const target = nodePath.join(cwd, '.mushi', 'lessons.json')

    // Fetch from API
    const res = await apiCall(
      `/v1/admin/lessons?projectId=${config.projectId}&limit=500`,
      config,
    ) as { ok?: boolean; data?: LessonRow[]; error?: string }

    if (!res.ok || !res.data) {
      console.error('Failed to fetch lessons:', res.error ?? JSON.stringify(res))
      process.exit(1)
    }

    const lessons: LessonsJson['lessons'] = res.data.map((l) => ({
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
      project_id: config.projectId,
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
      console.log(`✓ Wrote ${lessons.length} lessons to ${target}`)
    }
  })

interface LessonRow {
  id: string
  rule_text: string
  anti_pattern?: string | null
  severity: 'info' | 'warn' | 'critical'
  frequency: number
  last_reinforced_at?: string
  cluster_id?: string | null
}

interface LessonsJson {
  schema_version: '1'
  project_id: string
  generated_at: string
  lessons: Array<{
    id: string
    rule: string
    anti_pattern?: string
    severity: 'info' | 'warn' | 'critical'
    frequency: number
    last_reinforced: string
    cluster_id?: string
  }>
}

program.parse()
