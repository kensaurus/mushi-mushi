import type { Command } from 'commander';
import { requireConfig, API_TIMEOUT_MS } from '../cli-shared.js';

export function registerDeployCommands(program: Command): void {
// ─── deploy ───────────────────────────────────────────────────────────────────
const deploy = program.command('deploy').description('Deployment management')

deploy
  .command('check')
  .description('Check edge function health and measure latency')
  .option('--json', 'Machine-readable JSON output')
  .action(async (opts: { json?: boolean }) => {
    const config = requireConfig()
    const t0 = Date.now()
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
      const res = await fetch(`${config.endpoint}/health`, { signal: controller.signal })
      clearTimeout(timer)
      const latency = Date.now() - t0
      const body: Record<string, unknown> = res.headers.get('content-type')?.includes('json')
        ? await res.json().catch(() => ({}))
        : {}
      if (opts.json) {
        console.log(JSON.stringify({ ok: res.ok, status: res.status, latency_ms: latency, ...body }))
      } else {
        console.log(`Health: ${res.status === 200 ? 'OK' : 'FAIL'} (${res.status}) — ${latency}ms`)
        if (body['version']) console.log(`  Version: ${body['version']}`)
        if (body['region']) console.log(`  Region:  ${body['region']}`)
      }
      if (!res.ok) process.exit(1)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, error: msg }))
      } else {
        process.stderr.write(`error: ${msg}\n`)
      }
      process.exit(1)
    }
  })

}
