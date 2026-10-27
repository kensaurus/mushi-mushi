/**
 * FILE: packages/cli/src/commands/runner.ts
 * PURPOSE: `mushi runner status|compare|bill|placement|fix|heartbeat|hooks install|add|audit`
 *          (Plan 022, ADR 0033 / 0037): where your tests run, why a fix waits
 *          to land, and what each place costs.
 *
 *          - status     the CI view in the terminal (GET /v1/admin/ci/overview)
 *          - compare    cost and speed per repo × runner class, what-ifs
 *                       (GET /v1/admin/ci/compare; read-only)
 *          - bill       what GitHub actually charged, read with your own gh
 *                       login; --push uploads it (POST /v1/admin/ci/bill)
 *          - placement  where each repo's CI runs, the dry run of a change,
 *                       and a request for one (ADR 0037: only LINUX_RUNNER /
 *                       RUNNER_<WORKFLOW>; an owner or admin approves and
 *                       runs it in the console)
 *          - fix        open a draft PR that applies one CI cost fix to a
 *                       workflow (POST /v1/admin/ci/cost-fixes, ADR 0047);
 *                       `--all` previews every fix Mushi can open across your
 *                       apps and `--all --apply` opens one draft PR per repo
 *                       (/v1/admin/ci/cost-fix-rollout, ADR 0047 amendment);
 *                       fix-status shows it and, after the merge, the saving
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
import { renderCompare, type CiCompare } from '../runner/compare.js'
import { fetchActionsUsage, isGithubLogin, lookupOwner, parseMonth, renderBill, summarizeBill } from '../runner/bill.js'
import { renderPlacement, renderPreview, type PlacementPreviewView, type PlacementView } from '../runner/placement.js'
import { COST_FIX_KINDS, renderCostFix, waitForCostFix, type CostFixJob } from '../runner/cost-fix.js'
import {
  pickRolloutRequest,
  renderBundle,
  renderBundleResults,
  renderRolloutPreview,
  waitForBundles,
  type BundleResult,
  type CostFixBundle,
  type RolloutPreview,
} from '../runner/cost-fix-rollout.js'
import { assertNotCliKey, defaultRunnerKeyLabel, resolveRunnerKey, RUNNER_KEY_CREDENTIAL, RUNNER_KEY_PATH } from '../runner/key.js'

const HEARTBEAT_INTERVAL_MS = 120_000

/** Test seams: the host, gh and the step runner. */
interface RunnerDeps {
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

/** GITHUB_TOKEN, else `gh auth token`. Never printed. */
function githubTokenForBill(): string {
  const fromEnv = process.env['GITHUB_TOKEN']?.trim()
  if (fromEnv) return fromEnv
  const r = deps.gh(['auth', 'token'])
  const token = r.ok ? r.stdout.trim() : ''
  if (!token) throw new MushiCliError('E_INVALID_INPUT', 'No GitHub login on this machine.', 'Run `gh auth login`, or set GITHUB_TOKEN to a token that can read your billing.')
  return token
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
    .command('compare')
    .description('What CI costs and how fast it runs, per repo: GitHub-hosted vs your own machines, with what-ifs (estimated)')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--project <id>', 'Same as --project-id')
    .option('--all', 'Every project your key can read (account-level key)')
    .option('--days <n>', 'Window in days (1-30)', '30')
    .option('--json', 'Machine-readable JSON output')
    .addHelpText('after', `
Read-only: nothing is changed on GitHub. Wait and run times are measured from
GitHub's job times; billed minutes and money are estimated from GitHub's list
prices (dated), your plan's included minutes, and your electricity figures
(console: Settings → CI cost).`)
    .action(async (opts: { projectId?: string; project?: string; all?: boolean; days: string; json?: boolean }) => {
      const config = requireConfig()
      const days = Number(opts.days)
      if (!Number.isInteger(days) || days < 1 || days > 30) {
        throw new MushiCliError('E_INVALID_INPUT', '--days must be a whole number from 1 to 30.')
      }
      const qs = new URLSearchParams()
      const raw = opts.all ? undefined : (opts.projectId ?? opts.project ?? config.projectId)
      if (raw) qs.set('project_id', requireUuid(raw, 'project id'))
      qs.set('days', String(days))
      const result = await apiCall<CiCompare>(`/v1/admin/ci/compare?${qs}`, config, {}, { timeoutMs: 60_000 })
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      for (const line of renderCompare(result.data)) console.log(line)
    })

  runner
    .command('bill')
    .description('What GitHub actually charged for Actions this month, per repo (read with your own gh login)')
    .option('--month <yyyy-mm>', 'Month to read (default: this month, UTC)')
    .option('--owner <login>', 'GitHub user or organization whose bill to read (default: you)')
    .option('--push', 'Upload the month to Mushi, so the console shows the real bill')
    .option('--project-id <id>', 'Project to upload to with --push (defaults to the configured project)')
    .option('--project <id>', 'Same as --project-id')
    .option('--json', 'Machine-readable JSON output')
    .addHelpText('after', `
Reads GitHub's billing usage API with GITHUB_TOKEN, or the token of \`gh auth
login\`. The token stays on this machine and is never printed. A personal
account's bill needs your own login with the classic \`user\` scope, which
gh does not ask for by default (\`gh auth refresh -s user\`), or a
fine-grained token with Plan: read. An organization's needs an owner or
billing manager (Administration read).

Net is what GitHub charged; public repos and your plan's included minutes show
as discount. Copilot and other products are left out. With --push, the month's
Actions items go to POST /v1/admin/ci/bill for the configured project; the
owner must own one of the project's repositories.`)
    .action(async (opts: { month?: string; owner?: string; push?: boolean; projectId?: string; project?: string; json?: boolean }) => {
      const when = parseMonth(opts.month)
      if (!when) throw new MushiCliError('E_INVALID_INPUT', '--month must look like 2026-10.')
      if (opts.owner !== undefined && !isGithubLogin(opts.owner)) throw new MushiCliError('E_INVALID_INPUT', '--owner must be a GitHub user or organization name.')
      const config = opts.push ? requireConfig() : null
      const token = githubTokenForBill()
      const signal = getAbortSignal()
      const fetchFn: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, { ...init, signal })
      const who = await lookupOwner(fetchFn, token, opts.owner)
      if ('error' in who) throw new MushiCliError('E_API_ERROR', who.error)
      const usage = await fetchActionsUsage(fetchFn, token, who.owner, who.ownerType, when.year, when.month)
      if ('error' in usage) throw new MushiCliError('E_API_ERROR', usage.error)
      const summary = summarizeBill(who.owner, who.ownerType, when.year, when.month, usage.items)

      let pushed: unknown = null
      if (opts.push && config) {
        const raw = opts.projectId ?? opts.project ?? config.projectId
        const body = {
          ...(raw ? { projectId: requireUuid(raw, 'project id') } : {}),
          owner: who.owner,
          ownerType: who.ownerType,
          year: when.year,
          month: when.month,
          items: usage.items,
        }
        const result = await apiCall<{ owner: string; month: string; rows: number; netUsd: number }>('/v1/admin/ci/bill', config, { method: 'POST', body: JSON.stringify(body) }, { timeoutMs: 60_000 })
        if (!result.ok) die(result)
        pushed = result.data
      }

      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify({ ...summary, incomplete: usage.incomplete, ...(pushed ? { pushed } : {}) }, null, 2))
        return
      }
      for (const line of renderBill(summary)) console.log(line)
      if (usage.incomplete) console.log('  ! GitHub returned more than one page of usage; part of the month may be missing.')
      if (pushed) {
        const p = pushed as { rows: number; month: string }
        console.log(`\nUploaded ${p.rows} day × repo × SKU rows for ${p.month}. The console's CI page shows them now.`)
      } else if (!opts.json) {
        console.log('\nRun again with --push to show this bill in the Mushi console.')
      }
    })

  const placement = runner
    .command('placement')
    .description('Where each repo\'s CI runs, and changing it through one runner variable with approval (ADR 0037)')

  const placementBody = (opts: { projectId?: string; project?: string; repo: string; variable: string; value?: string; remove?: boolean }, config: CliConfig) => {
    if (!opts.remove && !opts.value) throw new MushiCliError('E_INVALID_INPUT', 'Pass --value <runner label>, or --remove to delete the variable.')
    if (opts.remove && opts.value) throw new MushiCliError('E_INVALID_INPUT', 'Pass either --value or --remove, not both.')
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(opts.repo)) throw new MushiCliError('E_INVALID_INPUT', '--repo must be owner/repo.')
    const raw = opts.projectId ?? opts.project ?? config.projectId
    if (!raw) throw new MushiCliError('E_INVALID_INPUT', 'Pass --project-id (or configure a project).')
    return { projectId: requireUuid(raw, 'project id'), repo: opts.repo, variable: opts.variable, value: opts.remove ? null : (opts.value as string) }
  }

  placement
    .command('show')
    .description('Each repo: the runner variables its workflows read and their values, the CI agreement, runner labels, pending requests')
    .option('--project-id <id>', 'Project ID (defaults to the configured project)')
    .option('--project <id>', 'Same as --project-id')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { projectId?: string; project?: string; json?: boolean }) => {
      const config = requireConfig()
      const raw = opts.projectId ?? opts.project ?? config.projectId
      if (!raw) throw new MushiCliError('E_INVALID_INPUT', 'Pass --project-id (or configure a project).')
      const result = await apiCall<PlacementView>(`/v1/admin/ci/placement?project_id=${encodeURIComponent(requireUuid(raw, 'project id'))}`, config, {}, { timeoutMs: 60_000 })
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      for (const line of renderPlacement(result.data)) console.log(line)
    })

  const placementAction = (verb: 'preview' | 'request') =>
    async (opts: { projectId?: string; project?: string; repo: string; variable: string; value?: string; remove?: boolean; reason?: string; json?: boolean }) => {
      const config = requireConfig()
      const body = { ...placementBody(opts, config), ...(verb === 'request' && opts.reason ? { reason: opts.reason.slice(0, 500) } : {}) }
      const path = verb === 'preview' ? '/v1/admin/ci/placement/preview' : '/v1/admin/ci/placement/requests'
      const result = await apiCall<PlacementPreviewView | { id: string; status: string; preview: PlacementPreviewView; next?: string }>(path, config, { method: 'POST', body: JSON.stringify(body) }, { timeoutMs: 60_000 })
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      if (verb === 'preview') {
        for (const line of renderPreview(result.data as PlacementPreviewView)) console.log(line)
        return
      }
      const r = result.data as { id: string; status: string; preview: PlacementPreviewView; next?: string }
      for (const line of renderPreview(r.preview)) console.log(line)
      console.log(`\nRequested ${r.id} (${r.status}). ${r.next ?? 'An owner or admin approves and runs it in the console.'}`)
    }

  const changeOptions = (cmd: Command): Command =>
    cmd
      .requiredOption('--repo <owner/repo>', 'Repository connected to the project')
      .option('--variable <name>', 'LINUX_RUNNER or RUNNER_<WORKFLOW>', 'LINUX_RUNNER')
      .option('--value <label>', 'The runner label jobs should ask for')
      .option('--remove', 'Remove the variable (jobs use the workflow\'s fallback, usually GitHub-hosted)')
      .option('--project-id <id>', 'Project ID (defaults to the configured project)')
      .option('--project <id>', 'Same as --project-id')
      .option('--json', 'Machine-readable JSON output')

  changeOptions(
    placement
      .command('preview')
      .description('Dry run: what would move, what stays and why, the target runners, cost, the CI agreement\'s verdict. Changes nothing'),
  ).action(placementAction('preview'))

  changeOptions(
    placement
      .command('request')
      .description('Ask for the change. Nothing changes until an owner or admin approves and runs it in the console'),
  )
    .option('--reason <text>', 'Why, shown to the approver')
    .action(placementAction('request'))

  placement
    .command('revert <requestId>')
    .description('Ask to undo a change that ran (it needs its own approval in the console)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (requestId: string, opts: { json?: boolean }) => {
      const config = requireConfig()
      const id = requireUuid(requestId, 'request id')
      const result = await apiCall<{ id: string; status: string; revertOf: string }>(`/v1/admin/ci/placement/requests/${id}/revert`, config, { method: 'POST' })
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data, null, 2))
        return
      }
      console.log(`Requested revert ${result.data.id} of ${result.data.revertOf} (${result.data.status}). An owner or admin approves and runs it in the console.`)
    })

  runner
    .command('fix')
    .description('Open a draft PR that applies one CI cost fix to a workflow (ADR 0047): add_concurrency, skip_drafts, weekly_cron or ignore_docs_paths. With --all: every fix Mushi can open across your apps, one draft PR per repo')
    .option('--repo <owner/repo>', 'Repository connected to the project (with --all: only these repos, comma-separated)')
    .option('--workflow <path>', 'Workflow file, e.g. .github/workflows/ci.yml')
    .option('--kind <kind>', `The fix: ${COST_FIX_KINDS.join(', ')}`)
    .option('--all', 'Every fix Mushi can open across the apps you may change, grouped per repo (a preview unless --apply)')
    .option('--preview', 'With --all: list the fixes and their saving per repo; changes nothing (the default)')
    .option('--apply', 'With --all: open one draft PR per repo (at most 10 repos and 20 fixes each per run)')
    .option('--include-blocked', 'With --all --apply: also try repos whose GitHub access Mushi knows cannot edit workflow files')
    .option('--project-id <id>', 'Project ID (defaults to the configured project; with --all, limits it to that app)')
    .option('--project <id>', 'Same as --project-id')
    .option('--wait', "Wait until the pull request is open (with --all: every repo's), and print its link")
    .option('--json', 'Machine-readable JSON output')
    .addHelpText('after', `
The PR is a draft: nothing changes until you review it, mark it ready and merge
it. After the merge, \`mushi runner fix-status <jobId>\` (or the console's CI
page) shows the billed minutes per day saved, measured against the 14 days
before. Writing a workflow file needs the GitHub App's "Workflows: Read and
write" permission (or a token with the workflow scope).

Every app at once (one PR per repo, so each repo runs CI once for all its fixes):
  mushi runner fix --all              preview: the fixes and estimated saving per repo
  mushi runner fix --all --apply      open them (refused edits are listed, never dropped)
  mushi runner fix-status --bundle <id>`)
    .action(async (opts: FixOpts) => {
      const config = requireConfig()
      if (opts.all) return fixAll(config, opts)
      if (opts.preview || opts.apply || opts.includeBlocked) throw new MushiCliError('E_INVALID_INPUT', '--preview, --apply and --include-blocked go with --all.')
      if (!opts.repo || !opts.workflow || !opts.kind) throw new MushiCliError('E_INVALID_INPUT', 'Pass --repo, --workflow and --kind (or --all for every app).')
      if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(opts.repo)) throw new MushiCliError('E_INVALID_INPUT', '--repo must be owner/repo.')
      if (!/^\.github\/workflows\/[A-Za-z0-9._/-]+\.ya?ml$/.test(opts.workflow) || opts.workflow.includes('..')) {
        throw new MushiCliError('E_INVALID_INPUT', '--workflow must be a file under .github/workflows/, e.g. .github/workflows/ci.yml.')
      }
      if (!(COST_FIX_KINDS as readonly string[]).includes(opts.kind)) {
        throw new MushiCliError('E_INVALID_INPUT', `--kind must be one of: ${COST_FIX_KINDS.join(', ')}.`)
      }
      const raw = opts.projectId ?? opts.project ?? config.projectId
      if (!raw) throw new MushiCliError('E_INVALID_INPUT', 'Pass --project-id (or configure a project).')
      const body = { projectId: requireUuid(raw, 'project id'), repo: opts.repo, workflowPath: opts.workflow, kind: opts.kind }
      const result = await apiCall<{ job: CostFixJob }>('/v1/admin/ci/cost-fixes', config, { method: 'POST', body: JSON.stringify(body) })
      if (!result.ok) die(result)
      let job = result.data.job
      if (opts.wait) job = await waitForCostFix(job, config)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(job, null, 2))
        return
      }
      for (const line of renderCostFix(job)) console.log(line)
    })

  runner
    .command('fix-status [jobId]')
    .description('CI cost fixes: one by id (its state, its PR, and after the merge the measured saving), a bundle (one PR for several fixes), or the project\'s recent ones')
    .option('--bundle <id>', "A bundle from `mushi runner fix --all --apply`: its PR and each fix's state")
    .option('--project-id <id>', 'Project ID for the list (defaults to the configured project)')
    .option('--project <id>', 'Same as --project-id')
    .option('--json', 'Machine-readable JSON output')
    .action(async (jobId: string | undefined, opts: { bundle?: string; projectId?: string; project?: string; json?: boolean }) => {
      const config = requireConfig()
      if (opts.bundle) {
        const result = await apiCall<{ bundle: CostFixBundle }>(`/v1/admin/ci/cost-fix-bundles/${requireUuid(opts.bundle, 'bundle id')}`, config)
        if (!result.ok) die(result)
        if (outputIsJson(opts.json)) {
          console.log(JSON.stringify(result.data.bundle, null, 2))
          return
        }
        for (const line of renderBundle(result.data.bundle)) console.log(line)
        return
      }
      if (jobId) {
        const result = await apiCall<{ job: CostFixJob }>(`/v1/admin/ci/cost-fixes/${requireUuid(jobId, 'job id')}`, config)
        if (!result.ok) die(result)
        if (outputIsJson(opts.json)) {
          console.log(JSON.stringify(result.data.job, null, 2))
          return
        }
        for (const line of renderCostFix(result.data.job)) console.log(line)
        return
      }
      const raw = opts.projectId ?? opts.project ?? config.projectId
      if (!raw) throw new MushiCliError('E_INVALID_INPUT', 'Pass a job id, or --project-id (or configure a project).')
      const result = await apiCall<{ jobs: CostFixJob[] }>(`/v1/admin/ci/cost-fixes?project_id=${encodeURIComponent(requireUuid(raw, 'project id'))}`, config)
      if (!result.ok) die(result)
      if (outputIsJson(opts.json)) {
        console.log(JSON.stringify(result.data.jobs, null, 2))
        return
      }
      if (result.data.jobs.length === 0) {
        console.log('No CI cost fixes yet. Open one with: mushi runner fix --repo <owner/repo> --workflow <path> --kind <kind>')
        return
      }
      for (const job of result.data.jobs) {
        for (const line of renderCostFix(job)) console.log(line)
        console.log(`  job ${job.id}\n`)
      }
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

interface FixOpts {
  repo?: string
  workflow?: string
  kind?: string
  all?: boolean
  preview?: boolean
  apply?: boolean
  includeBlocked?: boolean
  projectId?: string
  project?: string
  wait?: boolean
  json?: boolean
}

const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** `mushi runner fix --all [--apply]`: preview every app's fixes, or open one draft PR per repo. */
async function fixAll(config: ReturnType<typeof requireConfig>, opts: FixOpts): Promise<void> {
  if (opts.workflow || opts.kind) throw new MushiCliError('E_INVALID_INPUT', '--all opens every advised fix: drop --workflow and --kind (or drop --all for one fix).')
  if (opts.preview && opts.apply) throw new MushiCliError('E_INVALID_INPUT', 'Pick --preview or --apply, not both.')
  const raw = opts.projectId ?? opts.project
  const query = raw ? `?project_id=${encodeURIComponent(requireUuid(raw, 'project id'))}` : ''
  const preview = await apiCall<RolloutPreview>(`/v1/admin/ci/cost-fix-rollout${query}`, config)
  if (!preview.ok) die(preview)
  const repos = opts.repo?.split(',').map((r) => r.trim()).filter(Boolean)
  if (!opts.apply) {
    const shown = repos ? { ...preview.data, repos: preview.data.repos.filter((r) => repos.some((x) => sameRepo(x, r.repo))) } : preview.data
    if (outputIsJson(opts.json)) {
      console.log(JSON.stringify(shown, null, 2))
      return
    }
    for (const line of renderRolloutPreview(shown)) console.log(line)
    return
  }
  const pick = pickRolloutRequest(preview.data, { repos, includeBlocked: opts.includeBlocked })
  if (pick.repos.length === 0) {
    if (outputIsJson(opts.json)) {
      console.log(JSON.stringify({ results: [], queued: 0, leftOut: pick.leftOut }, null, 2))
      return
    }
    console.log('Nothing to open: no repo has a fix ready.')
    for (const l of pick.leftOut) console.log(`  ${l}`)
    return
  }
  const result = await apiCall<{ results: BundleResult[]; queued: number }>('/v1/admin/ci/cost-fix-rollout', config, {
    method: 'POST',
    body: JSON.stringify({ repos: pick.repos }),
  })
  if (!result.ok) die(result)
  const ids = result.data.results.flatMap((r) => (r.bundleId ? [r.bundleId] : []))
  const bundles = opts.wait && ids.length > 0 ? await waitForBundles(ids, config) : null
  if (outputIsJson(opts.json)) {
    console.log(JSON.stringify({ ...result.data, leftOut: pick.leftOut, ...(bundles ? { bundles } : {}) }, null, 2))
    return
  }
  if (bundles) {
    for (const b of bundles) for (const line of renderBundle(b)) console.log(line)
    for (const line of renderBundleResults(result.data.results.filter((r) => !r.bundleId))) console.log(line)
  } else {
    for (const line of renderBundleResults(result.data.results)) console.log(line)
  }
  if (pick.leftOut.length > 0) {
    console.log('Not sent this time:')
    for (const l of pick.leftOut) console.log(`  ${l}`)
  }
}
