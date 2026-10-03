import type { Command } from 'commander'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { apiCall, die, outputIsJson, requireConfig, requireUuid } from '../cli-shared.js'
import { scanLocalRepo, toIngestBody } from '../radar/scan.js'

interface RadarDetector {
  ruleId: string
  title: string
  state: 'ok' | 'finding' | 'unknown' | 'error'
  reason: string
  findings: Array<{ severity: string; message: string; fix: string | null }>
}

function headSha(dir: string): string | null {
  const env = process.env.GITHUB_SHA ?? process.env.CI_COMMIT_SHA ?? null
  if (env) return env
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

export function registerRadarCommands(program: Command): void {
  const radar = program
    .command('radar')
    .description('Hole checks that catch problems before a user hits them (store rules, storage, domains)')

  radar
    .command('scan')
    .description('Scan this repo and its built app for storage deletes done in SQL and secret keys, and read the build settings the store rules check')
    .option('--dir <path>', 'Repo root to scan', '.')
    .option('--push', 'Send the results to Mushi (run this in your existing CI job, after the build step)')
    .option('--json', 'Machine-readable JSON output')
    .addHelpText('after', `
What it checks here:
  storage_sql_delete     deleting storage.objects rows with SQL leaves the files in
                         the bucket, still billed. Delete through the Storage API.
  key_in_client_bundle   a secret key (OpenAI, Stripe live, Supabase secret, …) in
                         the built app (dist, build, out, .next/static, native JS
                         bundles). Anyone who opens the app can read it. Public keys
                         by design (Supabase anon key, Mushi SDK key) are not flagged.
                         Only where and which kind of key is sent, never the key.
With --push, Mushi also checks your Android target SDK and iOS build settings
against the current Google Play and App Store rules, from the build files only.

Add one step to your existing CI job, after the build step (no new job needed):
  - run: npx mushi-mushi radar scan --push
    env:
      MUSHI_API_KEY: \${{ secrets.MUSHI_INGEST_KEY }}`)
    .action(async (opts: { dir: string; push?: boolean; json?: boolean }) => {
      const root = resolve(opts.dir)
      let scan
      try {
        scan = scanLocalRepo(root)
      } catch (err) {
        process.stderr.write(`error: could not read ${root}: ${(err as Error).message}\n`)
        process.exitCode = 1
        return
      }
      const json = outputIsJson(opts.json)
      if (!opts.push) {
        const b = scan.bundle
        if (json) {
          console.log(JSON.stringify({ scannedFiles: scan.scannedFiles, truncated: scan.truncated, findings: scan.findings, configFiles: Object.keys(scan.configFiles), bundle: b }, null, 2))
        } else {
          console.log(`Scanned ${scan.scannedFiles} files${scan.truncated ? ' (stopped at the file limit)' : ''}${scan.unreadable ? ` (${scan.unreadable} could not be read)` : ''}.`)
          if (scan.findings.length === 0) console.log('No storage deletes done in SQL.')
          for (const f of scan.findings) console.log(`  WARN  ${f.message}`)
          if (b.scannedFiles === 0) {
            console.log('No built app found (dist, build, out, .next/static), so secret keys in the bundle were not checked. Run this after your build step.')
          } else {
            console.log(`Scanned ${b.scannedFiles} built files in ${b.roots.join(', ')}${b.truncated ? ' (stopped at the file limit)' : ''}${b.unreadable ? ` (${b.unreadable} could not be read)` : ''}.`)
            if (b.findings.length === 0) console.log('No secret keys in the built app.')
            for (const f of b.findings) console.log(`  ERROR ${f.filePath}:${f.line} contains a ${f.label}. Revoke it and move the call behind your server.`)
          }
          console.log(`Build files for the store rules: ${Object.keys(scan.configFiles).join(', ') || 'none found'}`)
          console.log('Run with --push to send these to Mushi.')
        }
        if (scan.findings.length > 0 || b.findings.length > 0) process.exitCode = 1
        return
      }
      const config = requireConfig()
      const result = await apiCall<{ status: string; results: Array<{ ruleId: string; state: string; reason: string }> }>(
        '/v1/ingest/radar',
        config,
        { method: 'POST', body: JSON.stringify(toIngestBody(scan, headSha(root))) },
      )
      if (!result.ok) die(result)
      if (json) {
        console.log(JSON.stringify(result.data, null, 2))
      } else {
        console.log(`Sent to Mushi (${result.data.status}).`)
        for (const r of result.data.results) console.log(`  ${r.state.toUpperCase().padEnd(8)} ${r.ruleId}: ${r.reason}`)
      }
    })

  radar
    .command('show')
    .description("Show every hole check for this project and what each one found")
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { projectId?: string; json?: boolean }) => {
      const config = requireConfig({ needsProject: !opts.projectId })
      const projectId = requireUuid(opts.projectId ?? config.projectId!, 'project id')
      const result = await apiCall<{ status: string; detectors: RadarDetector[] }>(`/v1/admin/projects/${projectId}/radar`, config)
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      for (const d of result.data.detectors) {
        const label = d.state === 'ok' ? 'OK' : d.state === 'finding' ? 'FOUND' : d.state === 'error' ? 'ERROR' : 'NOT CHECKED'
        console.log(`${label.padEnd(12)} ${d.title} — ${d.reason}`)
        for (const f of d.findings) console.log(`             ${f.severity.toUpperCase()}: ${f.message}`)
      }
    })
}
