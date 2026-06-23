import type { Command } from 'commander';
import { requireConfig, probeEndpointHealth } from '../cli-shared.js';

export function registerDeployCommands(program: Command): void {
// ─── deploy ───────────────────────────────────────────────────────────────────
const deploy = program.command('deploy').description('Deployment management')

deploy
  .command('check')
  .description('Check edge function health and measure latency')
  .option('--json', 'Machine-readable JSON output')
  .action(async (opts: { json?: boolean }) => {
    const config = requireConfig()
    try {
      const probe = await probeEndpointHealth(config.endpoint)
      if (opts.json) {
        console.log(JSON.stringify({ ok: probe.ok, status: probe.status, latency_ms: probe.latencyMs, ...probe.body }))
      } else {
        console.log(`Health: ${probe.status === 200 ? 'OK' : 'FAIL'} (${probe.status}) — ${probe.latencyMs}ms`)
        if (probe.body['version']) console.log(`  Version: ${probe.body['version']}`)
        if (probe.body['region']) console.log(`  Region:  ${probe.body['region']}`)
      }
      if (!probe.ok) process.exit(1)
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
