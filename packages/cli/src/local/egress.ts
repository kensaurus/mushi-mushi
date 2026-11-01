/**
 * FILE: packages/cli/src/local/egress.ts
 * PURPOSE: `mushi local status|verify` as data (Plan 023 Phase 0, ADR 0034):
 *          the tables, the overall verdict and the host-side probe.
 *          commands/local.ts calls the API and prints.
 *
 *          Contracts (server, api/routes/egress.ts):
 *            GET  /v1/admin/egress/status   → EgressStatus
 *            POST /v1/admin/egress/selftest → EgressSelftest
 */

import { connect } from 'node:net'

export interface EgressDenial {
  host: string
  caller: string | null
  day: string
  count: number
  lastAt: string | null
}

export interface EgressIntegration {
  id: string
  label: string
  destination: string | null
  enabled: boolean
  allowed: boolean
  note: string | null
}

export interface EgressStatus {
  localOnly: boolean
  allowlist: string[]
  denials: EgressDenial[]
  integrations: EgressIntegration[]
}

export type EgressOutcome = 'blocked_by_mushi' | 'network_unreachable' | 'reachable'

export interface EgressProbe {
  host: string
  outcome: EgressOutcome
  ms: number | null
}

export interface EgressSelftest {
  localOnly: boolean
  results: EgressProbe[]
  passed: boolean
}

/** The hosts `mushi local verify` tries when the server names none (Plan 023). */
export const DEFAULT_PROBE_HOSTS = [
  'api.anthropic.com',
  'api.openai.com',
  'ollama.com',
  'sentry.io',
  'api.github.com',
  'registry.npmjs.org',
] as const

const OUTCOME_LABEL: Record<EgressOutcome, string> = {
  blocked_by_mushi: 'blocked by Mushi',
  network_unreachable: 'unreachable',
  reachable: 'REACHABLE',
}

function table(rows: string[][]): string[] {
  if (rows.length === 0) return []
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)))
  return rows.map((r) => r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i]!))).join('  ').trimEnd())
}

export function renderStatus(s: EgressStatus): string[] {
  const out: string[] = []
  out.push(`Local-only: ${s.localOnly ? 'on' : 'off'}${s.localOnly ? '' : ' (outbound requests are not restricted; set MUSHI_LOCAL_ONLY=1 on the edge functions)'}`)
  out.push('')
  out.push('Allowlist:')
  if (s.allowlist.length === 0) out.push('  (none)')
  for (const h of s.allowlist) out.push(`  ${h}`)
  out.push('')
  out.push('Blocked requests:')
  if (s.denials.length === 0) out.push('  none recorded')
  else {
    out.push(...table([['  Day', 'Host', 'Count', 'Caller'], ...s.denials.map((d) => [`  ${d.day}`, d.host, String(d.count), d.caller ?? ''])]))
  }
  out.push('')
  out.push('What each integration would reach:')
  if (s.integrations.length === 0) out.push('  none listed')
  else {
    out.push(
      ...table([
        ['  Integration', 'Destination', 'On', 'Allowed', 'Note'],
        ...s.integrations.map((i) => [`  ${i.label}`, i.destination ?? '-', i.enabled ? 'yes' : 'no', i.allowed ? 'yes' : 'no', i.note ?? '']),
      ]),
    )
  }
  return out
}

export interface VerifyReport {
  ok: boolean
  /** Hosts that answered, from the edge runtime or (with --host-check) this machine. */
  reachable: string[]
  lines: string[]
}

/** The verify table and overall line. Fails when local-only is off or anything was reachable. */
export function renderVerify(selftest: EgressSelftest, hostCheck: EgressProbe[] | null): VerifyReport {
  const hosts = [...new Set([...selftest.results.map((r) => r.host), ...(hostCheck ?? []).map((r) => r.host)])]
  const edgeBy = new Map(selftest.results.map((r) => [r.host, r]))
  const hostBy = new Map((hostCheck ?? []).map((r) => [r.host, r]))
  const cell = (p: EgressProbe | undefined) => (p ? `${OUTCOME_LABEL[p.outcome]}${p.ms != null ? ` (${p.ms} ms)` : ''}` : '-')
  const rows = [
    ['Host', 'From the Mushi stack', ...(hostCheck ? ['From this machine'] : [])],
    ...hosts.map((h) => [h, cell(edgeBy.get(h)), ...(hostCheck ? [cell(hostBy.get(h))] : [])]),
  ]
  const reachable = hosts.filter((h) => edgeBy.get(h)?.outcome === 'reachable' || hostBy.get(h)?.outcome === 'reachable')
  const lines = [`Local-only: ${selftest.localOnly ? 'on' : 'off'}`, '', ...table(rows), '']
  if (reachable.length > 0) lines.push(`These hosts were reachable: ${reachable.join(', ')}`)
  else if (!selftest.localOnly) lines.push('Local-only is off: nothing stops the stack from reaching these hosts. Set MUSHI_LOCAL_ONLY=1 on the edge functions.')
  else lines.push('Nothing left this stack.')
  return { ok: selftest.localOnly && reachable.length === 0, reachable, lines }
}

export type TcpConnect = (host: string, port: number, timeoutMs: number) => Promise<'reachable' | 'network_unreachable'>

/**
 * Open a TCP connection to host:443 and close it at once: no TLS handshake,
 * no bytes sent. A connection that opens means this machine can reach the
 * host; DNS failure, refusal or the timeout mean it cannot.
 */
export const nodeTcpConnect: TcpConnect = (host, port, timeoutMs) =>
  new Promise((done) => {
    const socket = connect({ host, port })
    const finish = (outcome: 'reachable' | 'network_unreachable') => {
      socket.destroy()
      done(outcome)
    }
    socket.setTimeout(timeoutMs, () => finish('network_unreachable'))
    socket.once('connect', () => finish('reachable'))
    socket.once('error', () => finish('network_unreachable'))
  })

/** Try each host from this machine (3 s each, all at once). */
export async function hostCheck(hosts: readonly string[], tcp: TcpConnect = nodeTcpConnect, timeoutMs = 3000): Promise<EgressProbe[]> {
  return Promise.all(
    hosts.map(async (host) => {
      const started = Date.now()
      const outcome = await tcp(host, 443, timeoutMs).catch(() => 'network_unreachable' as const)
      return { host, outcome, ms: Date.now() - started }
    }),
  )
}
