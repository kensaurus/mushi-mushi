/**
 * FILE: packages/cli/src/commands/runner.ts
 * PURPOSE: `mushi runner status|heartbeat|hooks install|add|audit` (Plan 022,
 *          ADR 0033): where your tests run and why a fix waits to land.
 *
 *          - status     the CI view in the terminal (GET /v1/admin/ci/overview)
 *          - heartbeat  this machine's memory, swap, load and runner services
 *                       (POST /v1/ingest/runner, kind heartbeat)
 *          - hooks      job hooks that report each job's memory peak and OOM
 *                       kills (POST /v1/ingest/runner, kind job)
 *          - add        set this machine up as a runner with safe defaults
 *          - audit      list the self-hosted runners on your repos and flag
 *                       the ones to look at
 *
 *          The data work lives in ../runner/*; this file parses flags, prints,
 *          and runs a plan step by step.
 */

import type { Command } from 'commander'
import { spawnSync } from 'node:child_process'
import { accessSync, chmodSync, closeSync, constants as fsConstants, existsSync, fchownSync, fstatSync, ftruncateSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync, writeSync } from 'node:fs'
import { arch as nodeArch, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import * as p from '@clack/prompts'
import { apiCall, die, outputIsJson, requireConfig, requireUuid } from '../cli-shared.js'
import { loadConfig, type CliConfig } from '../config.js'
import { CLOUD_API_ENDPOINT } from '../endpoint.js'
import { MushiCliError } from '../errors.js'
import { getAbortSignal } from '../signals.js'
import { MUSHI_CLI_VERSION } from '../version.js'
import { buildAddPlan, defaultLabel, defaultMemory, parseResolvers, runnerArch, type AddPlan, type PlanStep } from '../runner/add-plan.js'
import { auditRepo, type RepoAudit } from '../runner/audit.js'
import {
  currentRepo,
  forkApprovalPolicy,
  ghAuthStatus,
  latestRunnerRelease,
  listOwnRepos,
  listRunners,
  nodeGh,
  prTargetWorkflows,
  registrationToken,
  repoIsPublic,
  type GhExec,
} from '../runner/github.js'
import { HOOKS_DIR_NAME, hookScript, mergeRunnerEnv } from '../runner/hooks.js'
import { collectHeartbeat, detectPlatform, hashHostId, nodeHostIO, readMachineId, UnsupportedHostError, type HostIO } from '../runner/host.js'
import { renderOverview, type CiOverview } from '../runner/overview.js'
import { assertNotCliKey, defaultRunnerKeyLabel, resolveRunnerKey, RUNNER_KEY_CREDENTIAL, RUNNER_KEY_PATH } from '../runner/key.js'

export const HEARTBEAT_INTERVAL_MS = 120_000

/** Test seams: the host, gh and the step runner. */
export interface RunnerDeps {
  host: HostIO
  gh: GhExec
  /** Runs one step; returns its exit code. */
  runStep: (step: PlanStep, stdin: string | undefined) => number
  /** systemd is PID 1 (sd_booted: /run/systemd/system exists). */
  systemdRunning: () => boolean
  /** `gh auth status` text, to tell whether gh keeps its token in a desktop keyring. */
  ghAuthText: () => string
}

/** A file's text through one descriptor (no symlinks), or '' when it does not exist. */
function readIfPresent(path: string): string {
  let fd: number
  try {
    fd = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
  try {
    return readFileSync(fd, 'utf8')
  } finally {
    closeSync(fd)
  }
}

/** Run `fn` on an open read descriptor of `path` (O_NOFOLLOW: never through a symlink). */
function withFd<T>(path: string, fn: (fd: number) => T): T {
  const fd = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
  try {
    return fn(fd)
  } finally {
    closeSync(fd)
  }
}

const defaultRunStep: RunnerDeps['runStep'] = (step, stdin) => {
  const argv = step.sudo ? ['sudo', 'sh', '-c', step.run] : ['sh', '-c', step.run]
  const res = spawnSync(argv[0]!, argv.slice(1), {
    stdio: [stdin === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'],
    input: stdin,
  })
  return res.status ?? 1
}

let deps: RunnerDeps = {
  host: nodeHostIO,
  gh: nodeGh,
  runStep: defaultRunStep,
  systemdRunning: () => existsSync('/run/systemd/system'),
  ghAuthText: () => ghAuthStatus().text,
}

/** @internal Tests only. */
export function __setRunnerDeps(next: Partial<RunnerDeps>): () => void {
  const prev = deps
  deps = { ...deps, ...next }
  return () => {
    deps = prev
  }
}

function hostIdOrThrow(): string {
  const raw = readMachineId(deps.host)
  if (!raw) throw new MushiCliError('E_INVALID_INPUT', 'Could not read a machine id on this host.', 'Linux and WSL2 need /etc/machine-id; macOS reads IOPlatformUUID.')
  return hashHostId(raw)
}

/**
 * The heartbeat's runner key: MUSHI_RUNNER_KEY, the systemd credential, then
 * --key-file or the default path. Never the CLI key.
 */
function readRunnerKeyForHeartbeat(keyFile: string | undefined): string {
  const fromEnv = process.env['MUSHI_RUNNER_KEY']?.trim()
  if (fromEnv) return fromEnv
  const credDir = process.env['CREDENTIALS_DIRECTORY']
  const paths = [
    ...(credDir ? [join(credDir, RUNNER_KEY_CREDENTIAL)] : []),
    keyFile ? resolve(keyFile) : RUNNER_KEY_PATH,
  ]
  for (const path of paths) {
    const key = deps.host.readFile(path)?.trim()
    if (key) return key
  }
  throw new MushiCliError(
    'E_AUTH_MISSING',
    `No runner key (MUSHI_RUNNER_KEY, or a readable ${keyFile ?? RUNNER_KEY_PATH}).`,
    'create one with `mushi runner key` (it can only report runner health; your CLI key is never used here)',
  )
}

/** `mushi runner key` always creates a new key (MUSHI_RUNNER_KEY is for the other commands). */
async function mintRunnerKeyOnly(config: CliConfig, project: string | undefined, label: string | undefined): Promise<string> {
  const { key } = await resolveRunnerKey(config, {
    projectId: project ? requireUuid(project, 'project id') : config.projectId,
    label: label ?? defaultRunnerKeyLabel(deps.host.hostname),
    env: {},
  })
  return key
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((done) => {
    if (signal.aborted) return done()
    const t = setTimeout(done, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      done()
    }, { once: true })
  })
}

function printPlan(plan: AddPlan, dryRun: boolean): void {
  for (const w of plan.warnings) console.log(`WARN  ${w}`)
  if (plan.warnings.length) console.log('')
  plan.steps.forEach((step, i) => {
    console.log(`[${i + 1}/${plan.steps.length}] ${step.title}`)
    console.log(`  $ ${step.sudo ? 'sudo ' : ''}sh -c ${JSON.stringify(step.run)}`)
    if (step.stdinSecret) console.log(`    (stdin: the ${step.stdinSecret === 'runner-key' ? 'runner key (runner:write)' : 'registration token'}, not shown)`)
    if (step.file && dryRun) {
      console.log(`    ${step.file.path}:`)
      for (const line of step.file.content.replace(/\n$/, '').split('\n')) console.log(`      ${line}`)
    }
  })
}

function printNotes(notes: string[]): void {
  if (!notes.length) return
  console.log('')
  for (const n of notes) console.log(n)
}

/** argv for the heartbeat timer: this CLI if installed for good, else a pinned npx. */
function heartbeatCommand(): string[] {
  const entry = process.argv[1] ? safeRealpath(process.argv[1]) : null
  if (entry && !entry.includes('/_npx/') && entry.endsWith('.js')) {
    return [process.execPath, entry, 'runner', 'heartbeat', '--once']
  }
  return [join(dirname(process.execPath), 'npx'), '-y', `@mushi-mushi/cli@${MUSHI_CLI_VERSION}`, 'runner', 'heartbeat', '--once']
}

function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

function auditLines(a: RepoAudit): string[] {
  const lines = [`${a.repo}`]
  if (a.runners.length === 0) lines.push('  No self-hosted runners.')
  for (const r of a.runners) {
    lines.push(`  ${(r.busy ? 'BUSY' : r.status.toUpperCase()).padEnd(8)} ${r.name}  [${r.labels.join(', ')}]${r.setUpByMushi ? '  (Mushi)' : ''}`)
  }
  for (const f of a.findings) lines.push(`  ${f.severity.toUpperCase().padEnd(8)} ${f.message}`)
  return lines
}

export function registerRunnerCommands(program: Command): void {
  const runner = program
    .command('runner')
    .description('Where your tests run and why a fix waits to land: CI runners, their machines, and one-command runner setup')

  runner
    .command('status')
    .description('Machines, runners, queue and run times, test-machine vs code failures, and what to do first')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--project <id>', 'Same as --project-id')
    .option('--all', 'Every project your key can read (account-level key)')
    .option('--days <n>', 'Window in days (1-30)', '7')
    .option('--refresh', 'Read GitHub first instead of the last 10-minute sync (at most once a minute per project)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { projectId?: string; project?: string; all?: boolean; days: string; refresh?: boolean; json?: boolean }) => {
      const config = requireConfig()
      const days = Number(opts.days)
      if (!Number.isInteger(days) || days < 1 || days > 30) {
        throw new MushiCliError('E_INVALID_INPUT', '--days must be a whole number from 1 to 30.')
      }
      const qs = new URLSearchParams()
      const raw = opts.all ? undefined : (opts.projectId ?? opts.project ?? config.projectId)
      if (raw) qs.set('project_id', requireUuid(raw, 'project id'))
      qs.set('days', String(days))
      if (opts.refresh) qs.set('refresh', '1')
      const result = await apiCall<CiOverview>(`/v1/admin/ci/overview?${qs}`, config, {}, { timeoutMs: opts.refresh ? 60_000 : undefined })
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      for (const line of renderOverview(result.data)) console.log(line)
    })

  runner
    .command('heartbeat')
    .description("Send this machine's memory, swap, load and runner services to Mushi (every 2 minutes, or once)")
    .option('--once', 'Send one heartbeat and exit (for a systemd timer or cron)')
    .option('--dry-run', 'Print the heartbeat JSON and send nothing')
    .option('--key-file <path>', `File holding the runner key (default ${RUNNER_KEY_PATH})`)
    .addHelpText('after', `
What is sent: the hostname, platform, CPU count, total memory, a sha256 hash of
the machine id (never the id), load, memory and swap in use, free disk, and for
each GitHub runner service: its name, repo, unit name, whether it runs, restarts,
memory use, memory limit and out-of-memory kills.
Never sent: file contents, environment values, process arguments, secrets.

It sends with a runner key (scope runner:write), which can only report runner
health, never your CLI key. The key is read from MUSHI_RUNNER_KEY, the systemd
credential "${RUNNER_KEY_CREDENTIAL}", --key-file, or ${RUNNER_KEY_PATH}.
Create one with \`mushi runner key\`.`)
    .action(async (opts: { once?: boolean; dryRun?: boolean; keyFile?: string }) => {
      const build = () => {
        try {
          return collectHeartbeat(deps.host, MUSHI_CLI_VERSION)
        } catch (err) {
          if (err instanceof UnsupportedHostError) throw new MushiCliError('E_INVALID_INPUT', err.message)
          throw err
        }
      }
      if (opts.dryRun) {
        console.log(JSON.stringify(build(), null, 2))
        return
      }
      const cli = loadConfig()
      const runnerKey = readRunnerKeyForHeartbeat(opts.keyFile)
      assertNotCliKey(runnerKey, cli.apiKey)
      // Only the endpoint comes from the CLI config; the key is the runner key.
      const config = { ...cli, apiKey: runnerKey, endpoint: cli.endpoint ?? CLOUD_API_ENDPOINT }
      const signal = getAbortSignal()
      for (;;) {
        const body = build()
        const result = await apiCall<unknown>('/v1/ingest/runner', config, { method: 'POST', body: JSON.stringify(body) })
        if (opts.once) {
          if (!result.ok) die(result)
          console.log(`Sent a heartbeat for ${body.host.hostname} with ${body.runners.length} runner(s).`)
          return
        }
        if (result.ok) {
          console.log(`${new Date().toISOString()} heartbeat sent (${body.runners.length} runner(s)).`)
        } else {
          process.stderr.write(`${new Date().toISOString()} heartbeat failed: ${result.error.code} — ${result.error.message}\n`)
        }
        await sleep(HEARTBEAT_INTERVAL_MS, signal)
        if (signal.aborted) return
      }
    })

  const hooks = runner.command('hooks').description('Job hooks that report memory peak and OOM kills for every job')
  hooks
    .command('install')
    .description("Write job hooks into a runner folder and turn them on in its .env")
    .requiredOption('--dir <path>', 'The runner folder (where config.sh and .runner live)')
    .option('--force', "Replace hooks the runner's .env already points somewhere else")
    .option('--project <id>', 'Project the runner key is for (defaults to the configured project)')
    .option('--label <name>', 'Label of the runner key (default: this host; shown as runner:<label>)')
    .option('--dry-run', 'Show what would be written and change nothing')
    .addHelpText('after', `
The hooks read the runner's own cgroup (memory.peak, memory.max, oom_kill), swap
and load, and send one sample per job. They always exit 0, so they never fail a
job. They send with a runner key (scope runner:write): a key that can only report
runner health. CI jobs run as the same user as the hooks and could read it; if
one steals it, all it can do is send fake numbers. Your CLI key never goes here.
The key comes from MUSHI_RUNNER_KEY, or a new one is created with your CLI key
(needs mcp:write). It is saved in <dir>/${HOOKS_DIR_NAME}/key with mode 0600,
never in the scripts, and never printed.
GitHub docs: https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/run-scripts`)
    .action(async (opts: { dir: string; force?: boolean; project?: string; label?: string; dryRun?: boolean }) => {
      const dir = resolve(opts.dir)
      if (!existsSync(join(dir, 'config.sh')) && !existsSync(join(dir, 'run.sh'))) {
        throw new MushiCliError('E_INVALID_INPUT', `${dir} does not look like a runner folder (no config.sh or run.sh).`)
      }
      const config = loadConfig()
      const endpoint = config.endpoint ?? CLOUD_API_ENDPOINT
      const hostId = hostIdOrThrow()
      const hooksDir = join(dir, HOOKS_DIR_NAME)
      const files = {
        started: join(hooksDir, 'job-started.sh'),
        completed: join(hooksDir, 'job-completed.sh'),
      }
      const envPath = join(dir, '.env')
      const envBefore = readIfPresent(envPath)
      const merged = mergeRunnerEnv(envBefore, files, opts.force)
      if (merged.conflicts.length) {
        for (const c of merged.conflicts) process.stderr.write(`${c.key} already runs ${c.current}\n`)
        throw new MushiCliError('E_INVALID_INPUT', "The runner's .env already sets a job hook.", 'chain it from the Mushi hook yourself, or pass --force to replace it')
      }
      if (opts.dryRun) {
        console.log(`Would write ${files.started} and ${files.completed} (mode 0755), and ${join(hooksDir, 'key')} (mode 0600, a runner:write key, not shown).`)
        const added = (merged.text ?? '').split('\n').filter((l) => l && !envBefore.split(/\r?\n/).includes(l))
        console.log(added.length ? `Would add to ${envPath}:\n${added.map((l) => `  ${l}`).join('\n')}` : `${envPath} already has the hooks.`)
        return
      }
      const { key: runnerKey, source } = await resolveRunnerKey(config, {
        projectId: opts.project ? requireUuid(opts.project, 'project id') : config.projectId,
        label: opts.label ?? defaultRunnerKeyLabel(deps.host.hostname),
      })
      mkdirSync(hooksDir, { recursive: true, mode: 0o755 })
      for (const phase of ['started', 'completed'] as const) {
        writeFileSync(files[phase], hookScript({ phase, endpoint, hostId }), { mode: 0o755 })
      }
      const keyPath = join(hooksDir, 'key')
      writeFileSync(keyPath, `${runnerKey}\n`, { mode: 0o600 })
      console.log(source === 'env' ? 'Using the runner key from MUSHI_RUNNER_KEY.' : 'Created a runner key (runner:write: it can only report runner health).')
      if (merged.text) {
        // Read and rewrite .env through one descriptor (no symlinks), merging
        // against what is there now, not what was read before the key was minted.
        const fd = openSync(envPath, fsConstants.O_RDWR | fsConstants.O_CREAT | (fsConstants.O_NOFOLLOW ?? 0), 0o644)
        try {
          const now = mergeRunnerEnv(readFileSync(fd, 'utf8'), files, opts.force)
          if (now.conflicts.length) throw new MushiCliError('E_INVALID_INPUT', "The runner's .env changed and now sets a job hook.", 'run the command again')
          if (now.text) {
            ftruncateSync(fd, 0)
            writeSync(fd, now.text, 0)
          }
        } finally {
          closeSync(fd)
        }
      }
      // The runner service usually runs as another user: hand it the files.
      // Owner read and chown go through open descriptors, so a path swapped
      // in between cannot redirect the chown (CodeQL js/file-system-race).
      const owner = withFd(dir, (fd) => fstatSync(fd))
      const me = process.getuid?.()
      if (me === 0 && owner.uid !== 0) {
        for (const path of [hooksDir, files.started, files.completed, keyPath, envPath]) {
          withFd(path, (fd) => fchownSync(fd, owner.uid, owner.gid))
        }
      } else if (me !== undefined && owner.uid !== me) {
        console.log(`The runner folder belongs to uid ${owner.uid}. Give it the hook files: sudo chown -R ${owner.uid}:${owner.gid} ${hooksDir}`)
      }
      console.log(`Installed the job hooks in ${hooksDir}.`)
      console.log('Restart the runner service so it reads its .env again, for example:')
      console.log(`  cd ${dir} && sudo ./svc.sh stop && sudo ./svc.sh start`)
    })

  runner
    .command('key')
    .description('Create a runner key (runner:write) and save it for the heartbeat; it is never printed')
    .option('--project <id>', 'Project the key is for (defaults to the configured project)')
    .option('--label <name>', 'Key label shown in the console (default: this host; shown as runner:<label>)')
    .option('--out <path>', 'Where to save it (mode 0600)', RUNNER_KEY_PATH)
    .addHelpText('after', `
A runner key can only report runner health. CI jobs on a self-hosted runner can
read files the runner user can read; if a job steals this key, all it can do is
send fake numbers. Your CLI key (which can merge pull requests) never goes on a
runner. Creating one needs a CLI key with mcp:write (mushi login --upgrade-scope).
${RUNNER_KEY_PATH} is root-only; the heartbeat timer gets it from systemd.`)
    .action(async (opts: { project?: string; label?: string; out: string }) => {
      const config = requireConfig()
      const key = await mintRunnerKeyOnly(config, opts.project, opts.label)
      const out = resolve(opts.out)
      const dir = dirname(out)
      const writable = (() => {
        try {
          accessSync(existsSync(dir) ? dir : dirname(dir), fsConstants.W_OK)
          return existsSync(dir) || process.getuid?.() === 0
        } catch {
          return false
        }
      })()
      if (writable) {
        mkdirSync(dir, { recursive: true, mode: 0o700 })
        writeFileSync(out, `${key}\n`, { mode: 0o600 })
        chmodSync(out, 0o600)
      } else {
        const step: PlanStep = {
          id: 'runner-key',
          title: `Save the runner key to ${out} (root, mode 0600)`,
          sudo: true,
          stdinSecret: 'runner-key',
          run: `install -d -m 0700 '${dir.replace(/'/g, `'"'"'`)}' && umask 077 && IFS= read -r k && printf '%s\\n' "$k" > '${out.replace(/'/g, `'"'"'`)}'`,
        }
        console.log(`$ sudo sh -c ${JSON.stringify(step.run)}   (stdin: the runner key, not shown)`)
        const code = deps.runStep(step, `${key}\n`)
        if (code !== 0) throw new MushiCliError('E_INVALID_INPUT', `Could not save the runner key to ${out} (exit ${code}).`, 'the new key was not shown; revoke it in the console and run this again')
      }
      console.log(`Saved a runner key to ${out}. It can only report runner health.`)
    })

  runner
    .command('add')
    .description('Set this machine up as a GitHub Actions runner for one repo, with safe defaults')
    .requiredOption('--repo <owner/name>', 'The repo the runner serves')
    .option('--label <label>', 'Runner label workflows opt in with (default mushi-<host>)')
    .option('--memory <size>', 'Memory cap for runner jobs, e.g. 8G (default 60% of RAM)')
    .option('--ephemeral', 'One job per runner, a fresh runner config per job (default)')
    .option('--persistent', 'One long-lived runner that takes job after job')
    .option('--allow-public', 'Allow a public repo (fork pull requests would run on this machine)')
    .option('--block-lan', 'Block the runner user from your LAN, tailnet and link-local addresses (nftables)')
    .option('--wsl-isolate', 'On WSL2: turn off Windows drives and Windows programs for this distro')
    .option('--set-variable', 'Set the LINUX_RUNNER repo variable to the label')
    .option('--uid <n>', 'uid for the runner user', '1990')
    .option('--user <name>', 'Name of the runner user', 'gha-runner')
    .option('--project <id>', 'Mushi project the runner key is for (defaults to the configured project)')
    .option('--yes', 'Run the steps without asking')
    .option('--dry-run', 'Print the whole plan and change nothing')
    .addHelpText('after', `
Safe defaults: private repos only; one job per runner; a dedicated user with no
admin rights and no view of /home; a memory cap so a build cannot freeze the
machine; a label of its own so GitHub-hosted runners stay the fallback. Every
command that needs root runs through sudo and is shown first. Self-hosted
runners are free on GitHub; this keeps your agents' fix PRs tested on a machine
you already own when your included minutes run out.
Docs: https://kensaur.us/mushi-mushi/docs/operating/ci-runners`)
    .action(async (opts: {
      repo: string; label?: string; memory?: string; ephemeral?: boolean; persistent?: boolean
      allowPublic?: boolean; blockLan?: boolean; wslIsolate?: boolean; setVariable?: boolean
      uid: string; user: string; project?: string; yes?: boolean; dryRun?: boolean
    }) => {
      if (opts.ephemeral && opts.persistent) throw new MushiCliError('E_INVALID_INPUT', 'Pick --ephemeral or --persistent, not both.')
      const host = deps.host
      const platform = detectPlatform(host)
      // The CLI key only creates the runner key; it is never written to the machine.
      const config = loadConfig()
      const endpoint = config.endpoint ?? CLOUD_API_ENDPOINT
      const archName = runnerArch(nodeArch())
      const gh = deps.gh
      const repo = opts.repo.trim()
      const preflight = platform === 'windows' || !/^[\w.-]+\/[\w.-]+$/.test(repo)
        ? { isPublic: null, forkApproval: null, prTargetWorkflows: null, release: null, keyring: false }
        : {
            isPublic: repoIsPublic(gh, repo),
            forkApproval: forkApprovalPolicy(gh, repo),
            prTargetWorkflows: prTargetWorkflows(gh, repo),
            release: archName && platform !== 'macos' ? latestRunnerRelease(gh, `linux-${archName}`) : null,
            keyring: /keyring/i.test(deps.ghAuthText()),
          }
      const rawId = platform === 'windows' ? null : readMachineId(host)
      const meminfo = host.readFile('/proc/meminfo') ?? ''
      const totalMb = Number(meminfo.match(/^MemTotal:\s+(\d+)/m)?.[1] ?? 0) / 1024 || host.totalMemBytes / 1024 / 1024
      const plan = buildAddPlan({
        repo,
        label: opts.label ?? defaultLabel(host.hostname),
        mode: opts.persistent ? 'persistent' : 'ephemeral',
        platform,
        arch: archName,
        memoryMax: opts.memory ?? defaultMemory(totalMb),
        runnerUser: opts.user,
        uid: Number(opts.uid),
        installUser: userInfo().username,
        release: preflight.release,
        endpoint,
        hostId: rawId ? hashHostId(rawId) : '',
        heartbeatCommand: heartbeatCommand(),
        blockLan: opts.blockLan === true,
        resolvers: parseResolvers(host.readFile('/etc/resolv.conf') ?? ''),
        systemdRunning: deps.systemdRunning(),
        wsl: platform === 'wsl2'
          ? { distro: process.env['WSL_DISTRO_NAME'] ?? null, wslConf: host.readFile('/etc/wsl.conf') ?? '', isolate: opts.wslIsolate === true }
          : null,
        setVariable: opts.setVariable === true,
        isPublic: preflight.isPublic,
        allowPublic: opts.allowPublic === true,
        forkApproval: preflight.forkApproval,
        prTargetWorkflows: preflight.prTargetWorkflows,
        ghTokenInKeyring: preflight.keyring,
      })

      if (outputIsJson()) {
        console.log(JSON.stringify(plan, null, 2))
        return
      }
      if (plan.refused) {
        for (const w of plan.warnings) console.log(`WARN  ${w}`)
        printNotes(plan.notes)
        throw new MushiCliError('E_INVALID_INPUT', plan.refused, 'nothing was changed')
      }
      printPlan(plan, opts.dryRun === true)
      if (opts.dryRun || plan.steps.length === 0) {
        printNotes(plan.notes)
        if (opts.dryRun) console.log('\nDry run: nothing was changed.')
        return
      }
      if (!opts.yes) {
        if (!process.stdin.isTTY) throw new MushiCliError('E_INVALID_INPUT', 'Not a terminal, so nothing was run.', 're-run with --yes, or with --dry-run to review the plan')
        const go = await p.confirm({ message: `Run these ${plan.steps.length} steps? sudo will ask for your password.` })
        if (go !== true) {
          console.log('Nothing was changed.')
          return
        }
      }
      // One runner key (runner:write) for the hooks and the heartbeat, before any step runs.
      let runnerKey: string | null = null
      if (plan.steps.some((s) => s.stdinSecret === 'runner-key')) {
        const resolved = await resolveRunnerKey(config, {
          projectId: opts.project ? requireUuid(opts.project, 'project id') : config.projectId,
          label: defaultRunnerKeyLabel(host.hostname),
        })
        runnerKey = resolved.key
        console.log(resolved.source === 'env' ? 'Using the runner key from MUSHI_RUNNER_KEY.' : 'Created a runner key (runner:write: it can only report runner health).')
      }
      for (const [i, step] of plan.steps.entries()) {
        console.log(`\n[${i + 1}/${plan.steps.length}] ${step.title}`)
        let stdin: string | undefined
        if (step.file) stdin = step.file.content
        if (step.stdinSecret === 'runner-key') stdin = `${runnerKey}\n`
        if (step.stdinSecret === 'registration-token') {
          const tok = registrationToken(gh, repo)
          if (!tok.ok) throw new MushiCliError('E_INVALID_INPUT', `Could not get a registration token: ${tok.error}`, 'your gh login needs Administration: write on the repo')
          stdin = `${tok.stdout.trim()}\n`
        }
        const code = deps.runStep(step, stdin)
        if (code !== 0) {
          throw new MushiCliError('E_INVALID_INPUT', `Step ${i + 1} (${step.id}) failed with exit code ${code}. Later steps did not run.`, 'fix the cause and run the same command again: the steps are safe to repeat')
        }
      }
      console.log('\nDone.')
      printNotes(plan.notes)
    })

  runner
    .command('audit')
    .description('List the self-hosted runners on your repos and flag the ones to look at')
    .option('--repo <owner/name>', 'One repo (default: the repo of this folder)')
    .option('--all', 'Every repo your gh login lists (up to 200)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { repo?: string; all?: boolean; json?: boolean }) => {
      const gh = deps.gh
      let repos: string[]
      if (opts.all) {
        const list = listOwnRepos(gh)
        if (!list) throw new MushiCliError('E_INVALID_INPUT', 'Could not list your repos with gh.', 'run `gh auth login` first')
        repos = list
      } else {
        const one = opts.repo ?? currentRepo(gh)
        if (!one) throw new MushiCliError('E_INVALID_INPUT', 'Which repo?', 'pass --repo owner/name, or --all')
        repos = [one]
      }
      // Runners Mushi has a heartbeat for, when Mushi is configured here.
      let heartbeatRunners: Set<string> | null = null
      const config = loadConfig()
      if (config.apiKey) {
        const qs = config.projectId ? `?project_id=${encodeURIComponent(config.projectId)}&days=7` : '?days=7'
        const ov = await apiCall<CiOverview>(`/v1/admin/ci/overview${qs}`, { ...config, endpoint: config.endpoint ?? CLOUD_API_ENDPOINT })
        if (ov.ok) {
          heartbeatRunners = new Set()
          for (const h of ov.data.hosts ?? []) {
            for (const r of (h['runners'] as Array<{ name?: string }> | undefined) ?? []) if (r.name) heartbeatRunners.add(r.name)
          }
        }
      }
      const audits: RepoAudit[] = []
      for (const repo of repos) {
        const { runners, error } = listRunners(gh, repo)
        // Only look closer at repos that have runners (or when asked for one repo).
        if (opts.all && runners !== null && runners.length === 0) continue
        audits.push(auditRepo({
          repo,
          runners,
          runnersError: error,
          heartbeatRunners,
          forkApproval: forkApprovalPolicy(gh, repo),
          prTargetWorkflows: prTargetWorkflows(gh, repo),
          isPublic: repoIsPublic(gh, repo),
        }))
      }
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify({ repos: audits }, null, 2))
      } else {
        if (audits.length === 0) console.log(`No self-hosted runners on ${repos.length} repo(s).`)
        for (const a of audits) for (const line of auditLines(a)) console.log(line)
      }
      if (audits.some((a) => a.findings.some((f) => f.severity === 'critical'))) process.exitCode = 1
    })
}
