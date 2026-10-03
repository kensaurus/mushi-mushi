/**
 * FILE: packages/cli/src/commands/connectors.ts
 * PURPOSE: `mushi connectors list|status` — read-only view of the team's
 *          connectors (GET /v1/admin/orgs/:orgId/connectors). Adding,
 *          probing and editing a connector takes credentials, so those stay
 *          in the console.
 */

import type { Command } from 'commander'
import { apiCall, fmtDate, outputIsJson, requireConfig } from '../cli-shared.js'
import { dieOrgError, oneLine, orgSegment } from '../command-helpers.js'
import { MushiCliError } from '../errors.js'

export interface ConnectorInstance {
  id: string
  project_id: string | null
  kind: string
  display_name: string | null
  granted_scopes: string[] | null
  enabled_capabilities: string[] | null
  status: string | null
  status_reason: string | null
  last_probe_at: string | null
  last_ok_at: string | null
  last_error: string | null
  bindings: Array<{ projectId: string; externalId: string; role: string }>
}

export interface ConnectorsData {
  organizationId: string
  available: Array<{ kind: string; title: string; capabilities: string[]; legacyBacked: boolean }>
  planned: unknown[]
  instances: ConnectorInstance[]
  legacy: Array<{ kind: string; project_id: string; ok: boolean; error: string | null; observed_at: string }>
}

export function renderConnectorList(data: ConnectorsData): string[] {
  const lines: string[] = []
  if (data.instances.length === 0 && data.legacy.length === 0) {
    lines.push('No connectors yet. Add one in the console: Portfolio → Connectors.')
  }
  for (const i of data.instances) {
    const status = (i.status ?? 'unknown').toUpperCase()
    lines.push(`  ${status.padEnd(10)} ${i.kind.padEnd(18)} ${oneLine(i.display_name ?? '', 30).padEnd(30)} ${i.id}`)
    if (i.status_reason || i.last_error) lines.push(`             ${oneLine(i.status_reason ?? i.last_error, 110)}`)
  }
  if (data.legacy.length > 0) {
    lines.push('Project integrations read as connectors:')
    for (const l of data.legacy) {
      lines.push(`  ${(l.ok ? 'OK' : 'ERROR').padEnd(10)} ${l.kind.padEnd(18)} project ${l.project_id}  (seen ${fmtDate(l.observed_at)})`)
      if (!l.ok && l.error) lines.push(`             ${oneLine(l.error, 110)}`)
    }
  }
  const unused = data.available.filter((a) => !data.instances.some((i) => i.kind === a.kind))
  if (unused.length > 0) lines.push(`Available to add: ${unused.map((a) => a.kind).join(', ')}`)
  return lines
}

export function renderConnectorStatus(i: ConnectorInstance): string[] {
  return [
    `${i.kind} — ${oneLine(i.display_name ?? '(no name)', 60)}`,
    `  id:            ${i.id}`,
    `  status:        ${i.status ?? 'unknown'}${i.status_reason ? ` (${oneLine(i.status_reason, 100)})` : ''}`,
    `  last probe:    ${fmtDate(i.last_probe_at)}`,
    `  last OK:       ${fmtDate(i.last_ok_at)}`,
    `  last error:    ${i.last_error ? oneLine(i.last_error, 100) : '—'}`,
    `  capabilities:  ${(i.enabled_capabilities ?? []).join(', ') || '—'}`,
    `  scopes:        ${(i.granted_scopes ?? []).join(', ') || '—'}`,
    `  bound apps:    ${i.bindings.length ? i.bindings.map((b) => `${b.projectId} (${b.role} ${b.externalId})`).join(', ') : '—'}`,
  ]
}

export interface ConnectorAction {
  id: string
  connector_instance_id: string
  project_id: string | null
  action: string
  reason: string | null
  status: string
  requested_at: string
  approved_at: string | null
  expires_at: string | null
  executed_at: string | null
  error: string | null
}

export function renderConnectorActions(actions: ConnectorAction[]): string[] {
  if (actions.length === 0) return ['No connector actions requested.']
  const lines: string[] = []
  for (const a of actions) {
    lines.push(`  ${a.status.toUpperCase().padEnd(17)} ${a.action.padEnd(24)} requested ${fmtDate(a.requested_at)}  ${a.id}`)
    if (a.reason) lines.push(`      why: ${oneLine(a.reason, 100)}`)
    if (a.error) lines.push(`      error: ${oneLine(a.error, 100)}`)
  }
  if (actions.some((a) => a.status === 'pending_approval')) lines.push('A team owner or admin approves pending actions in the console.')
  return lines
}

async function loadConnectors(org: string | undefined): Promise<ConnectorsData> {
  const config = requireConfig()
  const result = await apiCall<ConnectorsData>(`/v1/admin/orgs/${orgSegment(org)}/connectors`, config)
  if (!result.ok) dieOrgError(result)
  return result.data
}

export function registerConnectorsCommands(program: Command): void {
  const connectors = program
    .command('connectors')
    .description("Your team's connectors (read-only; add or edit them in the console)")

  connectors
    .command('list')
    .description('Every connector with its status and last error')
    .option('--org <id>', 'Organization UUID (default: your only organization)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { org?: string; json?: boolean }) => {
      const data = await loadConnectors(opts.org)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(data, null, 2))
        return
      }
      for (const line of renderConnectorList(data)) console.log(line)
    })

  connectors
    .command('status <connectorId>')
    .description('One connector: status, last probe, last error, bound apps')
    .option('--org <id>', 'Organization UUID (default: your only organization)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (connectorId: string, opts: { org?: string; json?: boolean }) => {
      const data = await loadConnectors(opts.org)
      const exact = data.instances.find((i) => i.id === connectorId)
      const matches = exact ? [exact] : data.instances.filter((i) => i.id.startsWith(connectorId))
      if (matches.length !== 1) {
        throw new MushiCliError(
          'E_INVALID_INPUT',
          matches.length === 0 ? `No connector ${connectorId} in this team.` : `${connectorId} matches ${matches.length} connectors.`,
          'copy the full id from `mushi connectors list`',
        )
      }
      const instance = matches[0]!
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(instance, null, 2))
        return
      }
      for (const line of renderConnectorStatus(instance)) console.log(line)
    })

  connectors
    .command('actions')
    .description('Actions requested on a connector and whether they were approved and run (latest 100)')
    .option('--org <id>', 'Organization UUID (default: your only organization)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { org?: string; json?: boolean }) => {
      const config = requireConfig()
      const result = await apiCall<{ actions: ConnectorAction[] }>(`/v1/admin/orgs/${orgSegment(opts.org)}/connector-actions`, config)
      if (!result.ok) dieOrgError(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      for (const line of renderConnectorActions(result.data.actions)) console.log(line)
    })
}
