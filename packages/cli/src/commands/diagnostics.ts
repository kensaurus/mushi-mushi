import type { Command } from 'commander';
import { MUSHI_CLI_VERSION } from '../version.js';
import { runSourcemapsUpload } from '../sourcemaps.js';
import { apiCall, die, outputIsJson, printResult, requireConfig } from '../cli-shared.js';
import { reportsUrl, resolveConsoleUrlSync } from '../console-url.js';

export function registerDiagnosticsCommands(program: Command): void {
// ─── test ─────────────────────────────────────────────────────────────────────
program
  .command('test')
  .description('Submit a synthetic test report to verify the ingestion pipeline end-to-end')
  .option('--json', 'Machine-readable JSON output (alias for -o json)')
  .action(async (opts: { json?: boolean }) => {
    const config = requireConfig()
    const result = await apiCall<{ reportId: string; status: string }>('/v1/reports', config, {
      method: 'POST',
      body: JSON.stringify({
        projectId: config.projectId,
        description: 'CLI test report — verifying ingestion pipeline',
        category: 'other',
        reporterToken: `cli-test-${Date.now()}`,
        createdAt: new Date().toISOString(),
        environment: {
          url: 'cli://test',
          userAgent: `mushi-cli/${MUSHI_CLI_VERSION}`,
          platform: process.platform,
          language: 'en',
          viewport: { width: 0, height: 0 },
          referrer: '',
          timestamp: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      }),
    })
    if (!result.ok) die(result)
    printResult(result.data, {
      json: opts.json,
      render(d) {
        console.log(`✓ Test report submitted`)
        console.log(`  ID:     ${d.reportId}`)
        console.log(`  Status: ${d.status}`)
        console.log(`  View:   ${reportsUrl(resolveConsoleUrlSync(), d.reportId)}`)
      },
    })
  })

// ─── index ────────────────────────────────────────────────────────────────────
program
  .command('index <path>')
  .description('Walk a local repo and upload code chunks to the Mushi RAG indexer')
  .option('--language <lang>', 'Limit to one language: ts, tsx, js, py, go, rs')
  .option('--dry-run', 'Show what would be uploaded without sending')
  .option('--json', 'Machine-readable summary: { files, bytes } (alias for -o json)')
  .addHelpText('after', `
Uploads source code into the Mushi vector index so the fix-worker can
retrieve relevant context when generating patches. Only needed for private
repos that cannot be auto-indexed via GitHub App.

Examples:
  mushi index ./src
  mushi index ./src --language ts --dry-run`)
  .action(async (path: string, opts: { language?: string; dryRun?: boolean; json?: boolean }) => {
    const config = requireConfig({ needsProject: true })

    const { readdir, readFile, stat } = await import('node:fs/promises')
    const nodePath = await import('node:path')

    const SKIP = /node_modules|\.git|dist|build|\.next|\.turbo|coverage/
    const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'])
    const MAX_FILE_BYTES = 500_000

    async function* walk(dir: string): AsyncGenerator<string> {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        const full = nodePath.join(dir, e.name)
        if (SKIP.test(full)) continue
        if (e.isDirectory()) yield* walk(full)
        else if (EXTS.has(nodePath.extname(e.name))) yield full
      }
    }

    let count = 0; let bytes = 0; let errors = 0
    const root = nodePath.resolve(path)

    for await (const file of walk(root)) {
      const lang = nodePath.extname(file).slice(1)
      if (opts.language && opts.language !== lang) continue
      const stats = await stat(file)
      if (stats.size > MAX_FILE_BYTES) {
        if (!opts.json) process.stdout.write(`  skip  ${nodePath.relative(root, file)} (>${MAX_FILE_BYTES / 1000}KB)\n`)
        continue
      }
      const source = await readFile(file, 'utf8')
      const relative = nodePath.relative(root, file).replaceAll('\\', '/')
      count++; bytes += source.length
      if (opts.dryRun) {
        if (!opts.json) process.stdout.write(`  ${relative} (${source.length} bytes)\n`)
        continue
      }
      const result = await apiCall<{ chunks: number }>('/v1/sync/codebase/upload', config, {
        method: 'POST',
        body: JSON.stringify({ projectId: config.projectId, filePath: relative, source }),
      })
      if (!result.ok) {
        errors++
        process.stderr.write(`  FAIL  ${relative}: ${result.error.message}\n`)
      } else if (!opts.json) {
        process.stdout.write(`  ok    ${relative} → ${result.data.chunks} chunks\n`)
      }
    }

    const summary = { ok: errors === 0, files: count, bytes, errors }
    if (outputIsJson(opts.json)) {
      console.log(JSON.stringify(summary, null, 2))
    } else {
      const kb = (bytes / 1024).toFixed(1)
      console.log(`\nIndexed ${count} files (${kb} KB) into project ${config.projectId}${errors ? ` — ${errors} failed` : ''}`)
    }
    if (errors > 0) process.exit(1)
  })

// ─── sourcemaps ───────────────────────────────────────────────────────────────
const sourcemaps = program.command('sourcemaps').description('Source map management')

sourcemaps
  .command('upload')
  .description('Upload source maps to Mushi (idempotent, SHA256-keyed) for stack trace symbolication')
  .requiredOption('--release <version>', 'Release identifier, e.g. 1.0.0 or a git SHA')
  .option('--dir <path>', 'Directory containing .map files', './dist')
  .option('--inject', 'Inject a Debug ID (UUID) into each .js and .map before uploading for exact stack-trace resolution')
  .option('--dry-run', 'List files that would be uploaded without uploading')
  .option('-e, --endpoint <url>', 'API endpoint (overrides MUSHI_API_ENDPOINT)')
  .option('--api-key <key>', 'API key (overrides MUSHI_API_KEY)')
  .option('--silent', 'Suppress progress output')
  .addHelpText('after', `
Examples:
  mushi sourcemaps upload --release 1.0.0
  mushi sourcemaps upload --release $(git rev-parse --short HEAD) --dir ./dist
  mushi sourcemaps upload --release 1.0.0 --inject   # recommended: adds Debug IDs`)
  .action(async (opts: {
    release: string; dir: string; inject?: boolean; dryRun?: boolean
    endpoint?: string; apiKey?: string; silent?: boolean
  }) => {
    await runSourcemapsUpload({
      release: opts.release, dir: opts.dir, inject: opts.inject, dryRun: opts.dryRun,
      endpoint: opts.endpoint, apiKey: opts.apiKey, silent: opts.silent,
    })
  })

}
