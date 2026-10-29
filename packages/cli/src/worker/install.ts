/**
 * FILE: packages/cli/src/worker/install.ts
 * PURPOSE: Pure parts of `mushi worker install` (ADR 0048): importing
 *          lane-v4's lanes.conf, and the service that starts the daemon
 *          (a systemd user unit on Linux and WSL2, a scheduled task on
 *          Windows). The command prints these and asks before writing.
 */

import { join } from 'node:path'
import { MushiCliError } from '../errors.js'
import { LANE_NAME_RE, MODEL_RE, type LaneConfig, type LocalLane } from './protocol.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * lane-v4's lanes.conf
 * (`<name> <profile|default> <clone> <projectId> <model> <mode>`) as worker
 * lanes. The profile column is dropped: one worker key serves every app.
 * Modes: queue and fix → fix (the queue now lives in Mushi), followups →
 * followups, off → fix and paused.
 */
export function parseLanesConf(text: string, cloneRoot: string): LocalLane[] {
  const lanes: LocalLane[] = []
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const cols = line.split(/\s+/)
    if (cols.length < 6) throw new MushiCliError('E_INVALID_INPUT', `lanes.conf line ${i + 1}: expected 6 columns (name profile clone projectId model mode).`)
    const [name, , clone, projectId, model, mode] = cols as [string, string, string, string, string, string]
    if (!LANE_NAME_RE.test(name)) throw new MushiCliError('E_INVALID_INPUT', `lanes.conf line ${i + 1}: lane name "${name}" must be lowercase letters, digits, ".", "_" or "-".`)
    if (!/^[A-Za-z0-9._-]+$/.test(clone)) throw new MushiCliError('E_INVALID_INPUT', `lanes.conf line ${i + 1}: clone "${clone}" must be a folder name.`)
    if (!UUID_RE.test(projectId)) throw new MushiCliError('E_INVALID_INPUT', `lanes.conf line ${i + 1}: "${projectId}" is not an app id.`)
    if (!MODEL_RE.test(model)) throw new MushiCliError('E_INVALID_INPUT', `lanes.conf line ${i + 1}: "${model}" is not a model id.`)
    const initial: Partial<LaneConfig> = { model }
    if (mode === 'followups' || mode === 'conflicts' || mode === 'audit' || mode === 'skill') initial.mode = mode
    else if (mode === 'queue' || mode === 'fix') initial.mode = 'fix'
    else if (mode === 'off') Object.assign(initial, { mode: 'fix', paused: true })
    else throw new MushiCliError('E_INVALID_INPUT', `lanes.conf line ${i + 1}: mode "${mode}" is not fix, followups, conflicts, audit, skill, queue or off.`)
    lanes.push({ name, projectId: projectId.toLowerCase(), repoDir: join(cloneRoot, clone), initial })
  }
  if (lanes.length === 0) throw new MushiCliError('E_INVALID_INPUT', 'lanes.conf lists no lanes.')
  return lanes
}

function systemdQuote(arg: string): string {
  return /[\s"\\]/.test(arg) ? `"${arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : arg
}

/**
 * The systemd user unit. The key is never in
 * it: the daemon reads the keychain or its 0600 file.
 */
export function systemdUnit(o: { node: string; cli: string; path: string; configPath?: string }): string {
  const exec = [o.node, o.cli, 'work', '--daemon', ...(o.configPath ? ['--worker-config', o.configPath] : [])].map(systemdQuote).join(' ')
  return `[Unit]
Description=Mushi local worker (mushi work --daemon)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${exec}
Environment=${systemdQuote(`PATH=${o.path}`)}
Restart=on-failure
RestartSec=300
# Exit 2: the key was revoked or is missing. Restarting would not help.
RestartPreventExitStatus=2
# The worker key comes from the keychain or ~/.config/mushi/worker.key (0600), never from this file.
NoNewPrivileges=yes

[Install]
WantedBy=default.target
`
}

export const SYSTEMD_UNIT_NAME = 'mushi-worker.service'
export const WINDOWS_TASK_NAME = 'Mushi worker'

/** `schtasks` arguments for a task that starts the daemon at logon. */
export function windowsTaskArgs(o: { node: string; cli: string; configPath?: string }): string[] {
  const run = [o.node, o.cli, 'work', '--daemon', ...(o.configPath ? ['--worker-config', o.configPath] : [])].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')
  return ['/Create', '/TN', WINDOWS_TASK_NAME, '/SC', 'ONLOGON', '/RL', 'LIMITED', '/F', '/TR', run]
}
