/**
 * FILE: packages/cli/src/commands/local.ts
 * PURPOSE: `mushi local status|verify` (Plan 023, ADR 0034): is this Mushi
 *          stack local-only, and can you prove nothing leaves it?
 *
 *          - status  local-only on or off, the allowlist, blocked requests by
 *                    host and day, what each integration would reach
 *                    (GET /v1/admin/egress/status)
 *          - verify  tries known cloud hosts from the edge runtime
 *                    (POST /v1/admin/egress/selftest) and, with --host-check,
 *                    from this machine; exits 1 when anything was reachable
 *                    or local-only is off
 *
 *          The data work lives in ../local/egress.ts.
 */

import type { Command } from 'commander'
import { apiCall, die, outputIsJson, requireConfig } from '../cli-shared.js'
import { DEFAULT_PROBE_HOSTS, hostCheck, renderStatus, renderVerify, type EgressSelftest, type EgressStatus, type TcpConnect } from '../local/egress.js'

let tcp: TcpConnect | undefined

/** @internal Exported for tests only. */
export function __setLocalTcp(next: TcpConnect | undefined): void {
  tcp = next
}

export function registerLocalCommands(program: Command): void {
  const local = program
    .command('local')
    .description('Run Mushi on your own machines and prove nothing leaves: local-only status and a self-test')

  local
    .command('status')
    .description('Local-only on or off, the allowlist, blocked requests by host and day, and what each integration would reach')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { json?: boolean }) => {
      const config = requireConfig()
      const result = await apiCall<EgressStatus>('/v1/admin/egress/status', config)
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      for (const line of renderStatus(result.data)) console.log(line)
    })

  local
    .command('verify')
    .description('Try known cloud hosts from the Mushi stack (and this machine with --host-check); exit 1 if any was reachable')
    .option('--json', 'Machine-readable JSON output')
    .option('--host-check', 'Also try the same hosts from this machine (a TCP connect to port 443, 3 s each, nothing sent)')
    .addHelpText('after', `
The stack tries ${DEFAULT_PROBE_HOSTS.join(', ')}
from its edge runtime; every attempt must fail. Each attempt is recorded as a
denial, so \`mushi local status\` shows it afterwards.
--host-check opens a TCP connection to port 443 of each host from this machine
and closes it at once (no TLS, no data), to show the machine itself has no route
out either.
Exit codes: 0 nothing was reachable and local-only is on; 1 otherwise.`)
    .action(async (opts: { json?: boolean; hostCheck?: boolean }) => {
      const config = requireConfig()
      const result = await apiCall<EgressSelftest>('/v1/admin/egress/selftest', config, { method: 'POST', body: '{}' }, { timeoutMs: 60_000 })
      if (!result.ok) die(result)
      const selftest = result.data
      const hosts = selftest.results.length ? selftest.results.map((r) => r.host) : [...DEFAULT_PROBE_HOSTS]
      const fromHere = opts.hostCheck ? await hostCheck(hosts, tcp) : null
      const report = renderVerify(selftest, fromHere)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify({ ...selftest, hostCheck: fromHere, reachable: report.reachable, ok: report.ok }, null, 2))
      } else {
        for (const line of report.lines) console.log(line)
      }
      if (!report.ok) process.exitCode = 1
    })
}
