/**
 * FILE: packages/cli/src/commands/worker.ts
 * PURPOSE: `mushi worker install|status|revoke` (ADR 0048): set up, read and
 *          remove the local worker that `mushi work --daemon` runs.
 *
 *   install  writes the lanes file (~/.config/mushi/worker.json; import
 *            lane-v4's lanes.conf with --lanes-conf), stores a worker key
 *            (scope worker:run) in the OS keychain or a 0600 file, and
 *            writes the service that starts the daemon: a systemd user unit
 *            on Linux and WSL2, a scheduled task on Windows. Everything is
 *            printed first and written only after a yes (or --yes).
 *   status   this machine's lanes, key and service, then every worker the
 *            console sees (GET /v1/admin/work/lanes): `lanectl status`. Its
 *            problems come first, the same flags the console shows (a stuck
 *            run with its stage, an offline machine, a failing account
 *            check, idle credits), each with what to do.
 *   revoke   the key revokes itself, is removed from this machine, and the
 *            service is stopped.
 *
 * The worker key can only take reports and record their fixes; it never
 * merges, changes settings or reads keys. Your CLI key never runs the daemon.
 */

import type { Command } from 'commander'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import * as p from '@clack/prompts'
import { apiCall, outputIsJson, requireConfig, requireUuid } from '../cli-shared.js'
import { loadConfig } from '../config.js'
import { MushiCliError } from '../errors.js'
import { isKeychainEnabled, tryDeleteWorkerKey, trySaveWorkerKey } from '../keychain.js'
import { assertWorkerKey, readWorkerKey } from '../worker/daemon.js'
import { flagLines, type WorkerFlagView } from '../worker/flags-view.js'
import { parseLanesConf, SYSTEMD_UNIT_NAME, systemdUnit, WINDOWS_TASK_NAME, windowsTaskArgs } from '../worker/install.js'
import { loadWorkerConfig, MODEL_RE, validateWorkerConfig, WORKER_CONFIG_PATH, WORKER_KEY_PATH, type LocalLane, type WorkerConfig } from '../worker/protocol.js'

const UNIT_PATH = join(process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config'), 'systemd', 'user', SYSTEMD_UNIT_NAME)

interface WorkLanesView {
  generatedAt: string
  /** Worker flags, worst first; missing from a server that predates them. */
  flags?: WorkerFlagView[]
  hosts: Array<{ id: string; hostname: string; platform: string; online: boolean; lastHeartbeatAt: string; status: Record<string, unknown>; guards: Record<string, number>; revoked: boolean; mine: boolean }>
  lanes: Array<{
    id: string
    hostId: string
    projectName: string
    name: string
    config: { paused: boolean; concurrency: number; model: string | null; mode: string; stop_at: string | null; drain: boolean }
    status: Record<string, unknown>
    active: unknown[]
    queue: unknown[]
    counts7d: { runs: number; prs: number; merges?: number; filed?: number; timeouts: number; errors: number; infra: number }
  }>
}

/** What a lane got done in 7 days, in its mode's terms. */
function laneDone(l: WorkLanesView['lanes'][number]): number {
  if (l.config.mode === 'conflicts') return l.counts7d.merges ?? 0
  if (l.config.mode === 'audit') return l.counts7d.filed ?? 0
  return l.counts7d.prs
}

async function readStdinKey(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8').trim()
}

function cliPath(): string {
  const argv1 = process.argv[1] ?? ''
  try {
    return realpathSync(argv1)
  } catch {
    return resolve(argv1)
  }
}

function lanesFromOptions(opts: { lanesConf?: string; cloneRoot?: string; lane?: string; project?: string; repoDir?: string; model?: string }): LocalLane[] {
  if (opts.lanesConf) {
    const root = resolve(opts.cloneRoot ?? join(homedir(), '.cache', 'mushi-work'))
    return parseLanesConf(readFileSync(resolve(opts.lanesConf), 'utf8'), root)
  }
  if (!opts.lane || !opts.project || !opts.repoDir) {
    throw new MushiCliError('E_INVALID_INPUT', 'Name one lane (--lane, --project, --repo-dir) or import --lanes-conf.', 'mushi worker install --lane my-app --project <app id> --repo-dir ~/src/my-app')
  }
  if (opts.model && !MODEL_RE.test(opts.model)) throw new MushiCliError('E_INVALID_INPUT', `--model "${opts.model}" is not a model id.`)
  return [{ name: opts.lane, projectId: requireUuid(opts.project, '--project'), repoDir: resolve(opts.repoDir), ...(opts.model ? { initial: { model: opts.model } } : {}) }]
}

function printLanes(cfg: WorkerConfig): void {
  for (const l of cfg.lanes) {
    const init = l.initial ? Object.entries(l.initial).map(([k, v]) => `${k}=${String(v)}`).join(' ') : 'console defaults'
    console.log(`  ${l.name.padEnd(16)} app ${l.projectId.slice(0, 8)}  clone ${l.repoDir}  (${init})`)
  }
}

export function registerWorkerCommands(program: Command): void {
  const worker = program.command('worker').description('Set up and read the local worker (`mushi work --daemon`): lanes, key and service')

  worker
    .command('install')
    .description('Write the lanes file, store a worker key (worker:run) and the service that runs `mushi work --daemon`; prints everything and asks first')
    .option('--lanes-conf <path>', "Import lane-v4's lanes.conf (name profile clone projectId model mode)")
    .option('--clone-root <dir>', 'With --lanes-conf: the folder that holds the clones', join(homedir(), '.cache', 'mushi-work'))
    .option('--lane <name>', 'One lane: its name')
    .option('--project <id>', 'One lane: its app id')
    .option('--repo-dir <path>', 'One lane: the clone it works in')
    .option('--model <id>', 'One lane: its model when it first registers (the console can change it)')
    .option('--stop-at <time>', 'Every lane stops taking reports at this time when it first registers (ISO, e.g. 2026-10-31T14:59:00Z); change it in the console later')
    .option('--cursor-account <email>', 'Spend only this Cursor account: a CLI signed in as anyone else counts as signed out')
    .option('--endpoint <url>', 'API endpoint (default: the CLI login\'s)')
    .option('--key-stdin', 'Read a worker key made in the console (Workers tab) from stdin instead of creating one')
    .option('--no-service', 'Write the lanes file and key only')
    .option('--yes', 'Do not ask before writing')
    .option('--dry-run', 'Print what would be written; write nothing')
    .action(async (opts: { lanesConf?: string; cloneRoot?: string; lane?: string; project?: string; repoDir?: string; model?: string; stopAt?: string; cursorAccount?: string; endpoint?: string; keyStdin?: boolean; service: boolean; yes?: boolean; dryRun?: boolean }) => {
      const cli = loadConfig()
      const endpoint = opts.endpoint ?? process.env['MUSHI_API_ENDPOINT'] ?? cli.endpoint
      let stopAt: string | null = null
      if (opts.stopAt) {
        const t = Date.parse(opts.stopAt)
        if (!Number.isFinite(t)) throw new MushiCliError('E_INVALID_INPUT', `--stop-at "${opts.stopAt}" is not a date and time.`, 'e.g. --stop-at 2026-10-31T14:59:00Z')
        stopAt = new Date(t).toISOString()
      }
      const lanes = lanesFromOptions(opts).map((l) => (stopAt ? { ...l, initial: { ...l.initial, stop_at: stopAt } } : l))
      const cfg = validateWorkerConfig({ version: 1, ...(endpoint ? { endpoint } : {}), ...(opts.cursorAccount ? { cursorAccount: opts.cursorAccount } : {}), lanes })
      const projectIds = [...new Set(cfg.lanes.map((l) => l.projectId))]
      const node = process.execPath
      const cli0 = cliPath()
      const platform = process.platform
      const service = !opts.service
        ? null
        : platform === 'win32'
          ? { kind: 'task' as const, args: windowsTaskArgs({ node, cli: cli0 }) }
          : platform === 'linux'
            ? { kind: 'systemd' as const, unit: systemdUnit({ node, cli: cli0, path: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin' }) }
            : null

      console.log(`Lanes (${WORKER_CONFIG_PATH}):`)
      printLanes(cfg)
      if (cfg.cursorAccount) console.log(`Cursor: spends only ${cfg.cursorAccount}; signed in as anyone else, the worker waits.`)
      const keySource = process.env['MUSHI_WORKER_KEY'] ? 'MUSHI_WORKER_KEY' : opts.keyStdin ? 'stdin' : `a new worker key for ${projectIds.length} app(s), made with your CLI login`
      console.log(`\nKey: ${keySource}; stored in ${isKeychainEnabled() ? 'the OS keychain' : `${WORKER_KEY_PATH} (mode 0600; no keychain here)`}. It can only take reports and record their fixes.`)
      if (service?.kind === 'systemd') {
        console.log(`\nService: ${UNIT_PATH}\n${service.unit.replace(/^/gm, '  ')}`)
        console.log(`Then: systemctl --user daemon-reload && systemctl --user enable --now ${SYSTEMD_UNIT_NAME}`)
        console.log('To start at boot without a login (as root, once): loginctl enable-linger <this user>')
      } else if (service?.kind === 'task') {
        console.log(`\nService: a scheduled task that starts at logon:\n  schtasks ${service.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`)
      } else if (opts.service) {
        console.log(`\nService: not automated on ${platform}; run \`mushi work --daemon\` under your service manager.`)
      }
      if (opts.dryRun) {
        console.log('\nDry run: nothing was written.')
        return
      }
      if (!opts.yes) {
        if (!process.stdin.isTTY || opts.keyStdin) throw new MushiCliError('E_INVALID_INPUT', 'Not a terminal (or stdin holds the key), so nothing was written.', 're-run with --yes, or --dry-run to review')
        const go = await p.confirm({ message: 'Write these?' })
        if (go !== true) {
          console.log('Nothing was written.')
          return
        }
      }

      let key = process.env['MUSHI_WORKER_KEY']?.trim() || (opts.keyStdin ? await readStdinKey() : '')
      if (!key) {
        const conf = requireConfig()
        const res = await apiCall<{ key: string; prefix: string }>('/v1/admin/work/key', conf, { method: 'POST', body: JSON.stringify({ projectIds, label: hostname().split('.')[0] }) })
        if (!res.ok) {
          throw new MushiCliError(
            'E_API_ERROR',
            `The worker key was not created: ${res.error.code} ${res.error.message}`,
            'Your CLI key needs mcp:write on every lane\'s app (an account key for several apps). Or make the key in the console (Pipeline → Workers) and pass it with --key-stdin.',
          )
        }
        key = res.data.key
      }
      // Refuses the CLI key itself and anything that is not a Mushi key.
      assertWorkerKey(key, cli.apiKey)

      mkdirSync(dirname(WORKER_CONFIG_PATH), { recursive: true })
      writeFileSync(WORKER_CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 })
      if (trySaveWorkerKey(key)) {
        if (existsSync(WORKER_KEY_PATH)) rmSync(WORKER_KEY_PATH)
        console.log('Saved the worker key in the OS keychain.')
      } else {
        writeFileSync(WORKER_KEY_PATH, `${key}\n`, { mode: 0o600 })
        chmodSync(WORKER_KEY_PATH, 0o600)
        console.log(`Saved the worker key in ${WORKER_KEY_PATH} (mode 0600).`)
      }
      console.log(`Wrote ${WORKER_CONFIG_PATH}.`)
      if (service?.kind === 'systemd') {
        mkdirSync(dirname(UNIT_PATH), { recursive: true })
        writeFileSync(UNIT_PATH, service.unit)
        const reload = spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' })
        const enable = reload.status === 0 ? spawnSync('systemctl', ['--user', 'enable', '--now', SYSTEMD_UNIT_NAME], { stdio: 'inherit' }) : reload
        console.log(enable.status === 0 ? `Started ${SYSTEMD_UNIT_NAME}. Logs: journalctl --user -u ${SYSTEMD_UNIT_NAME} -f` : `Wrote ${UNIT_PATH}; start it with: systemctl --user enable --now ${SYSTEMD_UNIT_NAME}`)
      } else if (service?.kind === 'task') {
        const r = spawnSync('schtasks', service.args, { stdio: 'inherit' })
        console.log(r.status === 0 ? `Created the scheduled task "${WINDOWS_TASK_NAME}"; it starts at your next logon.` : 'The scheduled task was not created; run the schtasks line above yourself.')
      }
      console.log('The console shows this worker on Pipeline → Workers within a minute of its first heartbeat.')
    })

  worker
    .command('status')
    .description('This machine\'s lanes, key and service, then every worker the console sees (lanectl status)')
    .option('--project <id>', 'Only lanes of this app')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { project?: string; json?: boolean }) => {
      let local: WorkerConfig | null = null
      try {
        local = loadWorkerConfig()
      } catch {
        local = null
      }
      const serviceState =
        process.platform === 'linux'
          ? (() => {
              const r = spawnSync('systemctl', ['--user', 'is-active', SYSTEMD_UNIT_NAME], { encoding: 'utf8' })
              return r.stdout?.trim() || 'unknown'
            })()
          : process.platform === 'win32'
            ? (() => {
                try {
                  execFileSync('schtasks', ['/Query', '/TN', WINDOWS_TASK_NAME], { stdio: 'ignore' })
                  return 'scheduled'
                } catch {
                  return 'not installed'
                }
              })()
            : 'unknown'
      const conf = requireConfig()
      const q = opts.project ? `?projectId=${encodeURIComponent(requireUuid(opts.project, '--project'))}` : ''
      const res = await apiCall<WorkLanesView>(`/v1/admin/work/lanes${q}`, conf)
      if (outputIsJson(opts.json)) {
        process.stdout.write(`${JSON.stringify({ local, service: serviceState, server: res.ok ? res.data : { error: res.error } }, null, 2)}\n`)
        return
      }
      console.log(`This machine: ${local ? `${local.lanes.length} lane(s) in ${WORKER_CONFIG_PATH}` : 'no worker set up (mushi worker install)'}; service ${serviceState}.`)
      if (!res.ok) {
        console.log(`Could not read the workers: ${res.error.code} ${res.error.message}`)
        process.exitCode = 1
        return
      }
      const problems = flagLines(res.data.flags)
      if (problems.length) {
        console.log(`\n${problems.join('\n')}`)
        // A machine that cannot work is not a success.
        if (res.data.flags!.some((f) => f.severity === 'danger')) process.exitCode = 2
      } else if (res.data.flags) {
        console.log('\nNo problems: every worker the console sees is doing useful work or has nothing to take.')
      }
      const hosts = new Map(res.data.hosts.map((h) => [h.id, h]))
      for (const h of res.data.hosts) {
        console.log(`\n${h.hostname} (${h.platform}) ${h.revoked ? 'revoked' : h.online ? 'online' : 'offline'}, last heartbeat ${h.lastHeartbeatAt.slice(0, 16).replace('T', ' ')} UTC, ${String(h.status['state'] ?? '?')}; up to ${h.guards['max_agents']} agents`)
      }
      if (res.data.lanes.length === 0) {
        console.log('\nNo lanes registered yet.')
        return
      }
      console.log(`\n${'lane'.padEnd(16)} ${'app'.padEnd(16)} ${'mode'.padEnd(10)} ${'state'.padEnd(13)} ${'model'.padEnd(22)} ${'run'.padStart(4)} ${'done'.padStart(4)} ${'tmo'.padStart(4)} ${'err'.padStart(4)} ${'queue'.padStart(5)}  host`)
      for (const l of res.data.lanes) {
        const state = l.config.paused ? 'paused' : l.config.drain ? 'draining' : String(l.status['state'] ?? '?')
        console.log(
          `${l.name.padEnd(16)} ${l.projectName.slice(0, 16).padEnd(16)} ${l.config.mode.padEnd(10)} ${state.padEnd(13)} ${(l.config.model ?? 'default').slice(0, 22).padEnd(22)} ${String(l.counts7d.runs).padStart(4)} ${String(laneDone(l)).padStart(4)} ${String(l.counts7d.timeouts).padStart(4)} ${String(l.counts7d.errors).padStart(4)} ${String(l.queue.length).padStart(5)}  ${hosts.get(l.hostId)?.hostname ?? '?'}`,
        )
      }
      console.log('\nRuns are the last 7 days; "done" is PRs opened (fix, skill), merges pushed (conflicts) or passes that filed findings (audit). Change lanes on Pipeline → Workers in the console.')
    })

  worker
    .command('revoke')
    .description('Revoke this machine\'s worker key, remove it from this machine and stop the service')
    .option('--yes', 'Do not ask first')
    .action(async (opts: { yes?: boolean }) => {
      if (!opts.yes) {
        if (!process.stdin.isTTY) throw new MushiCliError('E_INVALID_INPUT', 'Not a terminal, so nothing was changed.', 're-run with --yes')
        const go = await p.confirm({ message: 'Revoke this machine\'s worker key and stop the worker? Runs in progress are stopped.' })
        if (go !== true) {
          console.log('Nothing was changed.')
          return
        }
      }
      const cli = loadConfig()
      let key: string | null = null
      try {
        key = readWorkerKey(cli.apiKey)
      } catch {
        key = null
      }
      if (key) {
        const endpoint = (() => {
          try {
            return loadWorkerConfig().endpoint
          } catch {
            return undefined
          }
        })() ?? process.env['MUSHI_API_ENDPOINT'] ?? cli.endpoint
        const res = await apiCall('/v1/worker/revoke', { apiKey: key, endpoint }, { method: 'POST', body: '{}' })
        console.log(res.ok ? 'Revoked the worker key in Mushi.' : `The server did not revoke it (${res.error.code}); revoke it in the console (Pipeline → Workers).`)
      } else {
        console.log('No worker key on this machine.')
      }
      tryDeleteWorkerKey()
      if (existsSync(WORKER_KEY_PATH)) rmSync(WORKER_KEY_PATH)
      if (process.platform === 'linux') spawnSync('systemctl', ['--user', 'disable', '--now', SYSTEMD_UNIT_NAME], { stdio: 'inherit' })
      if (process.platform === 'win32') spawnSync('schtasks', ['/Delete', '/TN', WINDOWS_TASK_NAME, '/F'], { stdio: 'inherit' })
      console.log(`Removed the key from this machine. The lanes file (${WORKER_CONFIG_PATH}) is kept; delete it if you do not need it.`)
    })
}
