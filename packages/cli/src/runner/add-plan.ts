/**
 * FILE: packages/cli/src/runner/add-plan.ts
 * PURPOSE: `mushi runner add` as data (Plan 022 Phase 5, ADR 0033): turns what
 *          the CLI learned about this machine and the repo into the exact list
 *          of shell steps that set the machine up as a GitHub Actions runner.
 *          Pure, so every default is unit-tested; commands/runner.ts prints the
 *          plan and runs it.
 *
 *          Safe defaults, and why:
 *          - Private repos only. GitHub: self-hosted runners "should almost
 *            never be used for public repositories" because a pull request
 *            from a fork runs its code on your machine.
 *            https://docs.github.com/en/actions/reference/security/secure-use
 *          - One job per runner (JIT, `--ephemeral`, the default). A fresh
 *            runner config is minted before every job with your own `gh`
 *            login (or a token file you add), and the work folder is wiped,
 *            so one job cannot leave something behind for the next.
 *          - A dedicated non-admin user with a fixed uid, never your account
 *            and never root. The service cannot see /home.
 *          - A memory-capped systemd slice, so a hungry build is stopped by
 *            its own limit instead of freezing the machine.
 *          - A label of its own (`mushi-<host>`), so only workflows that opt
 *            in run there and GitHub-hosted runners stay the fallback.
 *          - Optional: block the runner user from your LAN and tailnet in an
 *            nftables table of its own (never `flush ruleset`: on WSL2 other
 *            distros share the VM's netfilter).
 *
 *          Secrets never appear in a step: the registration token and the
 *          Mushi API key reach their step on stdin (`stdinSecret`), and the
 *          runner reads its token from ACTIONS_RUNNER_INPUT_* environment
 *          variables, not from process arguments.
 */

import type { RunnerPlatform } from './host.js'
import { HOOKS_DIR_NAME, HOOK_ENV_COMPLETED, HOOK_ENV_STARTED, hookScript } from './hooks.js'

export type RunnerMode = 'ephemeral' | 'persistent'
export type RunnerArch = 'x64' | 'arm64'

export interface AddPlanInput {
  repo: string
  label: string
  mode: RunnerMode
  platform: RunnerPlatform
  arch: RunnerArch | null
  /** systemd memory size, e.g. "8G". */
  memoryMax: string
  runnerUser: string
  uid: number
  /** The person running `mushi runner add`; their `gh` login mints runner configs. */
  installUser: string
  /** actions/runner release to install, with the SHA-256 GitHub publishes for it. */
  release: { version: string; sha256: string } | null
  endpoint: string
  hostId: string
  /** argv that runs `mushi runner heartbeat --once` as installUser. */
  heartbeatCommand: string[]
  blockLan: boolean
  /** nameserver lines from /etc/resolv.conf, allowed through the LAN block. */
  resolvers: string[]
  systemdRunning: boolean
  wsl: { distro: string | null; wslConf: string; isolate: boolean } | null
  setVariable: boolean
  /** From the preflight: the repo is public (refused unless allowPublic). */
  isPublic: boolean | null
  allowPublic: boolean
  /** Fork PR approval policy (all_external_contributors is the strict one); null when unreadable. */
  forkApproval: string | null
  /** Workflow files that use pull_request_target; null when unreadable. */
  prTargetWorkflows: string[] | null
  /** gh keeps its token in a desktop keyring a system service cannot read. */
  ghTokenInKeyring: boolean
}

export interface PlanStep {
  id: string
  title: string
  /** Run with `sudo sh -c` (true) or `sh -c` as you (false). */
  sudo: boolean
  run: string
  /** A file this step writes; its content goes to the command on stdin and is shown in the plan. */
  file?: { path: string; content: string }
  /** A secret the executor pipes to `run` on stdin. Never printed, never in argv. */
  stdinSecret?: 'registration-token' | 'api-key'
}

export interface AddPlan {
  /** Why nothing will run; steps is empty. */
  refused: string | null
  steps: PlanStep[]
  warnings: string[]
  /** Printed after the steps (workflow snippet, WSL keepalive, macOS steps). */
  notes: string[]
}

const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/
const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/
const MEMORY_RE = /^\d+(?:\.\d+)?[MG]$/

export const RUNNER_ROOT = '/opt/mushi-runner'
export const LIB_DIR = '/usr/local/lib/mushi-runner'
export const ETC_DIR = '/etc/mushi-runner'
export const UNIT_DIR = '/etc/systemd/system'
export const SLICE = 'mushi-runner.slice'

/** `mushi-<short hostname>`: lowercase letters, digits and dashes, ≤ 40 chars. */
export function defaultLabel(hostname: string): string {
  const short = hostname.split('.')[0]!.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  return `mushi-${short || 'runner'}`.slice(0, 40).replace(/-+$/, '')
}

/** 60% of RAM as a systemd size. */
export function defaultMemory(totalMb: number): string {
  const mb = Math.floor(totalMb * 0.6)
  return mb >= 2048 ? `${Math.floor(mb / 1024)}G` : `${Math.max(mb, 512)}M`
}

export function runnerArch(nodeArch: string): RunnerArch | null {
  if (nodeArch === 'x64') return 'x64'
  if (nodeArch === 'arm64') return 'arm64'
  return null
}

/** The SHA-256 actions/runner publishes in its release notes: `<!-- BEGIN SHA linux-x64 -->…<!-- END SHA linux-x64 -->`. */
export function parseRunnerSha(body: string, target: string): string | null {
  const esc = target.replace(/[-.]/g, (c) => `\\${c}`)
  const m = body.match(new RegExp(`<!--\\s*BEGIN SHA ${esc}\\s*-->\\s*([0-9a-f]{64})\\s*<!--\\s*END SHA ${esc}\\s*-->`, 'i'))
  return m ? m[1]!.toLowerCase() : null
}

/** nameserver lines of /etc/resolv.conf (IPv4 only; the LAN block is IPv4 + ULA). */
export function parseResolvers(resolvConf: string): string[] {
  const out: string[] = []
  for (const line of resolvConf.split('\n')) {
    const m = line.match(/^\s*nameserver\s+(\d{1,3}(?:\.\d{1,3}){3})\s*$/)
    if (m && !out.includes(m[1]!)) out.push(m[1]!)
  }
  return out
}

/**
 * Set keys in an INI file (/etc/wsl.conf), keeping everything else. Returns
 * the new text, or null when every key already has the wanted value.
 */
export function mergeIni(existing: string, wanted: Record<string, Record<string, string>>): string | null {
  const lines = existing.replace(/\r\n/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  let changed = false
  for (const [section, keys] of Object.entries(wanted)) {
    let start = lines.findIndex((l) => l.trim().toLowerCase() === `[${section.toLowerCase()}]`)
    if (start === -1) {
      if (lines.length && lines[lines.length - 1]!.trim() !== '') lines.push('')
      lines.push(`[${section}]`)
      start = lines.length - 1
    }
    for (const [key, value] of Object.entries(keys)) {
      let end = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l))
      if (end === -1) end = lines.length
      const idx = lines.findIndex((l, i) => i > start && i < end && new RegExp(`^\\s*${key}\\s*=`, 'i').test(l))
      if (idx === -1) {
        let insertAt = end
        while (insertAt > start + 1 && lines[insertAt - 1]!.trim() === '') insertAt--
        lines.splice(insertAt, 0, `${key}=${value}`)
        changed = true
      } else if (lines[idx]!.split('=').slice(1).join('=').trim().toLowerCase() !== value.toLowerCase()) {
        lines[idx] = `${key}=${value}`
        changed = true
      }
    }
  }
  return changed ? `${lines.join('\n')}\n` : null
}

const q = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`

/** A file write as a step: content on stdin, then mode and owner. */
function fileStep(id: string, title: string, path: string, content: string, mode: string, owner = 'root:root'): PlanStep {
  const dir = path.slice(0, path.lastIndexOf('/')) || '/'
  return {
    id,
    title,
    sudo: true,
    run: `mkdir -p ${q(dir)} && cat > ${q(path)} && chmod ${mode} ${q(path)} && chown ${owner} ${q(path)}`,
    file: { path, content },
  }
}

function notesForWorkflows(label: string, setVariable: boolean, repo: string): string[] {
  return [
    'Point a workflow at this machine (only workflows that ask for the label run here):',
    `  runs-on: [self-hosted, ${label}]`,
    'Or keep GitHub-hosted runners as the fallback with a repository variable:',
    "  runs-on: ${{ vars.LINUX_RUNNER || 'ubuntu-latest' }}",
    setVariable
      ? `  (this plan sets LINUX_RUNNER=${label} on ${repo})`
      : `  gh variable set LINUX_RUNNER --repo ${repo} --body ${label}   (or re-run with --set-variable)`,
  ]
}

function wslNotes(distro: string | null): string[] {
  const d = distro ?? '<your distro>'
  return [
    'WSL2 stops a distro about 15 s after its last terminal closes, and the VM a minute later, so the runner goes offline.',
    'Keep it running: in %USERPROFILE%\\.wslconfig on Windows set',
    '  [general]',
    '  instanceIdleTimeout=-1',
    '  [wsl2]',
    '  vmIdleTimeout=-1',
    'then run `wsl --shutdown` once. And start the distro at logon (PowerShell, as you):',
    `  schtasks /Create /TN "mushi-runner-keepalive-${d}" /SC ONLOGON /RL LIMITED /F /TR "wsl.exe -d ${d} -u root --exec sleep infinity"`,
  ]
}

function macNotes(input: AddPlanInput): string[] {
  return [
    'On macOS Mushi prints the steps instead of running them. Use a user-session LaunchAgent (not a daemon), so jobs reach the keychain and the iOS simulator:',
    '  1. Create a standard (non-admin) macOS user for the runner and log in to it once (fast user switching keeps it running).',
    `  2. As that user, download the runner from https://github.com/actions/runner/releases (osx-${input.arch ?? 'arm64'}) and check its SHA-256 against the release notes.`,
    `  3. Register it with your own gh login: TOKEN=$(gh api -X POST repos/${input.repo}/actions/runners/registration-token --jq .token)`,
    `     ACTIONS_RUNNER_INPUT_TOKEN="$TOKEN" ./config.sh --unattended --url https://github.com/${input.repo} --name ${input.label} --labels ${input.label}`,
    '  4. ./svc.sh install && ./svc.sh start   (installs a LaunchAgent for that user)',
    `  5. mushi runner hooks install --dir <runner folder>, then restart the agent.`,
    ...notesForWorkflows(input.label, false, input.repo),
  ]
}

function validate(input: AddPlanInput): string | null {
  if (!REPO_RE.test(input.repo)) return `"${input.repo}" is not owner/name.`
  if (!LABEL_RE.test(input.label)) return `Label "${input.label}" must be lowercase letters, digits and dashes (≤ 40).`
  if (!USER_RE.test(input.runnerUser)) return `Runner user "${input.runnerUser}" is not a valid user name.`
  if (!USER_RE.test(input.installUser)) return `Could not tell who you are ("${input.installUser}").`
  if (input.installUser === 'root') return 'Run `mushi runner add` as yourself, not as root. It uses sudo for the steps that need it, and your own gh login.'
  if (input.installUser === input.runnerUser) return 'The runner needs its own user, not yours.'
  if (!Number.isInteger(input.uid) || input.uid < 500 || input.uid > 60000) return 'The runner uid must be between 500 and 60000.'
  if (!MEMORY_RE.test(input.memoryMax)) return `Memory "${input.memoryMax}" must look like 8G or 6144M.`
  if (!/^[0-9a-f]{64}$/.test(input.hostId)) return 'Could not hash a machine id for this host.'
  if (input.wsl?.distro && !/^[A-Za-z0-9._-]+$/.test(input.wsl.distro)) return 'Unexpected WSL distro name.'
  return null
}

export function buildAddPlan(input: AddPlanInput): AddPlan {
  const warnings: string[] = []
  const refuse = (why: string, notes: string[] = []): AddPlan => ({ refused: why, steps: [], warnings, notes })

  if (input.platform === 'windows') {
    return refuse(
      'Mushi sets up runners on Linux, WSL2 and macOS. On Windows, install WSL2 (`wsl --install`), open the distro and run `mushi runner add` there: the runner then lives in its own Linux user, apart from your Windows files.',
    )
  }
  const invalid = validate(input)
  if (invalid) return refuse(invalid)

  if (input.isPublic === true && !input.allowPublic) {
    return refuse(
      `${input.repo} is public. A pull request from a fork would run its code on this machine, and GitHub says self-hosted runners "should almost never be used for public repositories" (https://docs.github.com/en/actions/reference/security/secure-use). Use GitHub-hosted runners for it (public repos run free), or pass --allow-public if you accept that risk.`,
    )
  }
  if (input.isPublic === true) warnings.push(`${input.repo} is public and --allow-public is set: any fork pull request your settings let run will run on this machine.`)
  if (input.isPublic === null) warnings.push(`Could not read whether ${input.repo} is public; check it is private before you point workflows here.`)
  if (input.forkApproval === null) {
    warnings.push('Could not read the fork pull request approval setting (Settings → Actions → General).')
  } else if (input.forkApproval !== 'all_external_contributors') {
    warnings.push(`Fork pull requests from some outside contributors run without approval (${input.forkApproval}). Set "Require approval for all external contributors" in Settings → Actions → General.`)
  }
  if (input.prTargetWorkflows && input.prTargetWorkflows.length > 0) {
    warnings.push(`These workflows use pull_request_target, which runs with your secrets on fork pull requests; keep them off this runner: ${input.prTargetWorkflows.join(', ')}`)
  }
  warnings.push('Cloud agents push branches inside the repo, so fork approval does not stop code an agent wrote from running here. Review what your agents can push.')

  if (input.platform === 'macos') {
    return { refused: null, steps: [], warnings, notes: macNotes(input) }
  }
  if (!input.arch) return refuse('This CPU is not supported by the GitHub runner (x64 or arm64 only).')

  const steps: PlanStep[] = []

  if (input.platform === 'wsl2' && input.wsl) {
    const wanted: Record<string, Record<string, string>> = { boot: { systemd: 'true' } }
    if (input.wsl.isolate) {
      wanted['automount'] = { enabled: 'false' }
      wanted['interop'] = { enabled: 'false', appendWindowsPath: 'false' }
    }
    const merged = mergeIni(input.wsl.wslConf, wanted)
    if (merged) {
      steps.push(fileStep('wsl-conf', 'Update /etc/wsl.conf (systemd on' + (input.wsl.isolate ? '; Windows drives and Windows programs off for this distro' : '') + ')', '/etc/wsl.conf', merged, '0644'))
    }
    if (!input.wsl.isolate) {
      warnings.push('Jobs in this distro can read your Windows drives (/mnt/c) and start Windows programs. Re-run with --wsl-isolate to turn both off for this distro (it needs a `wsl --shutdown`).')
    }
    if (!input.systemdRunning) {
      return {
        refused: null,
        steps,
        warnings,
        notes: ['systemd is not running in this distro yet. After these steps run `wsl --shutdown` in Windows, open the distro again and run `mushi runner add` again.'],
      }
    }
  } else if (!input.systemdRunning) {
    return refuse('This machine does not run systemd, which the runner service, its memory cap and the heartbeat timer need.')
  }

  if (!input.release) return refuse('Could not read the latest actions/runner release and its published SHA-256, so there is nothing safe to download.')

  const target = `linux-${input.arch}`
  const dir = `${RUNNER_ROOT}/${input.label}`
  const ru = input.runnerUser
  const unit = `mushi-runner-${input.label}.service`
  const tarball = `actions-runner-${target}-${input.release.version}.tar.gz`
  const url = `https://github.com/actions/runner/releases/download/v${input.release.version}/${tarball}`

  steps.push({
    id: 'user',
    title: `Create the ${ru} user (uid ${input.uid}, no login shell, not an admin)`,
    sudo: true,
    run: `if id -u ${ru} >/dev/null 2>&1; then echo '${ru} already exists'; elif getent passwd ${input.uid} >/dev/null; then echo 'uid ${input.uid} is taken; pass --uid' >&2; exit 1; else useradd --system --uid ${input.uid} --user-group --home-dir /var/lib/${ru} --create-home --shell /usr/sbin/nologin ${ru}; fi`,
  })

  steps.push({
    id: 'download',
    title: `Download actions/runner ${input.release.version} and check its SHA-256`,
    sudo: true,
    run: [
      'set -e',
      'tmp=$(mktemp -d)',
      `curl -fsSL --proto '=https' -o "$tmp/runner.tgz" ${q(url)}`,
      `echo '${input.release.sha256}  '"$tmp/runner.tgz" | sha256sum -c -`,
      `install -d -o ${ru} -g ${ru} -m 0750 ${q(dir)}`,
      `tar -xzf "$tmp/runner.tgz" -C ${q(dir)}`,
      `chown -R ${ru}:${ru} ${q(dir)}`,
      'rm -rf "$tmp"',
    ].join('; '),
  })

  steps.push({
    id: 'deps',
    title: "Install the runner's system libraries (its own script)",
    sudo: true,
    run: `${q(`${dir}/bin/installdependencies.sh`)}`,
  })

  steps.push(fileStep(
    'slice',
    `Cap runner memory at ${input.memoryMax} (systemd slice)`,
    `${UNIT_DIR}/${SLICE}`,
    [
      '[Unit]',
      'Description=Mushi runners: memory and CPU limits',
      '',
      '[Slice]',
      `MemoryMax=${input.memoryMax}`,
      // Throttle (reclaim) before the hard limit so a build slows down before it is killed.
      `MemoryHigh=${memoryHigh(input.memoryMax)}`,
      'CPUWeight=50',
      'TasksMax=4096',
      '',
    ].join('\n'),
    '0644',
  ))

  const osLabel = 'Linux'
  const archLabel = input.arch === 'arm64' ? 'ARM64' : 'X64'
  const hardening = [
    'NoNewPrivileges=yes',
    'PrivateTmp=yes',
    'ProtectHome=yes',
    'ProtectSystem=full',
    'ProtectKernelTunables=yes',
    'ProtectKernelModules=yes',
    'ProtectControlGroups=yes',
    'RestrictSUIDSGID=yes',
  ]

  if (input.mode === 'ephemeral') {
    const tokenFile = `${ETC_DIR}/${input.label}.gh-token`
    steps.push(fileStep(
      'mint',
      'Write the script that mints a one-job runner config before every job',
      `${LIB_DIR}/${input.label}-mint.sh`,
      [
        '#!/bin/sh',
        `# Mints a one-job (JIT) runner config for ${input.repo}. Runs as root before`,
        `# each job (ExecStartPre=+). Uses ${tokenFile} (a fine-grained token with`,
        `# Administration: write on this repo only) when it exists, else ${input.installUser}'s gh login.`,
        'set -eu',
        'umask 077',
        `rm -rf ${q(`${dir}/_work`)}`,
        `NAME="${input.label}-$(date +%s)"`,
        `if [ -r ${q(tokenFile)} ]; then GH_TOKEN=$(cat ${q(tokenFile)}); export GH_TOKEN; GH=gh; else GH="runuser -u ${input.installUser} -- gh"; fi`,
        `$GH api -X POST repos/${input.repo}/actions/runners/generate-jitconfig \\`,
        `  -f name="$NAME" -F runner_group_id=1 -f work_folder=_work \\`,
        `  -f 'labels[]=self-hosted' -f 'labels[]=${osLabel}' -f 'labels[]=${archLabel}' -f 'labels[]=${input.label}' \\`,
        '  --jq .encoded_jit_config > "$RUNTIME_DIRECTORY/jit"',
        `chown ${ru}:${ru} "$RUNTIME_DIRECTORY/jit"`,
        '',
      ].join('\n'),
      '0755',
    ))
    steps.push(fileStep(
      'start',
      'Write the script that starts the runner with that config (read from a 0600 file, passed as an environment variable)',
      `${LIB_DIR}/${input.label}-start.sh`,
      [
        '#!/bin/sh',
        'set -eu',
        'ACTIONS_RUNNER_INPUT_JITCONFIG=$(cat "$RUNTIME_DIRECTORY/jit")',
        'rm -f "$RUNTIME_DIRECTORY/jit"',
        'export ACTIONS_RUNNER_INPUT_JITCONFIG',
        `exec ${q(`${dir}/run.sh`)}`,
        '',
      ].join('\n'),
      '0755',
    ))
    steps.push(fileStep('service', `Write the ${unit} service (one job, then a fresh runner)`, `${UNIT_DIR}/${unit}`, [
      '[Unit]',
      `Description=Mushi GitHub Actions runner ${input.label} for ${input.repo} (one job per runner)`,
      'After=network-online.target',
      'Wants=network-online.target',
      '',
      '[Service]',
      `User=${ru}`,
      `Group=${ru}`,
      `Slice=${SLICE}`,
      `WorkingDirectory=${dir}`,
      `RuntimeDirectory=mushi-runner-${input.label}`,
      'RuntimeDirectoryMode=0700',
      `ExecStartPre=+${LIB_DIR}/${input.label}-mint.sh`,
      `ExecStart=${LIB_DIR}/${input.label}-start.sh`,
      'Restart=always',
      'RestartSec=15',
      'KillSignal=SIGINT',
      'TimeoutStopSec=5min',
      ...hardening,
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      '',
    ].join('\n'), '0644'))
    if (input.ghTokenInKeyring) {
      warnings.push(`Your gh login is in a desktop keyring, which a background service cannot read, so minting will fail. Create a fine-grained token with Administration: write on ${input.repo} only and save it as ${tokenFile} (root, mode 0600).`)
    }
  } else {
    steps.push({
      id: 'register',
      title: `Register the runner with ${input.repo} (token from your gh login, passed on stdin)`,
      sudo: true,
      stdinSecret: 'registration-token',
      run: `cd ${q(dir)} && runuser -u ${ru} -- sh -c 'IFS= read -r ACTIONS_RUNNER_INPUT_TOKEN; export ACTIONS_RUNNER_INPUT_TOKEN; exec ./config.sh --unattended --replace --url https://github.com/${input.repo} --name ${input.label} --labels ${input.label} --work _work'`,
    })
    steps.push(fileStep('service', `Write the ${unit} service`, `${UNIT_DIR}/${unit}`, [
      '[Unit]',
      `Description=Mushi GitHub Actions runner ${input.label} for ${input.repo}`,
      'After=network-online.target',
      'Wants=network-online.target',
      '',
      '[Service]',
      `User=${ru}`,
      `Group=${ru}`,
      `Slice=${SLICE}`,
      `WorkingDirectory=${dir}`,
      `ExecStart=${dir}/run.sh`,
      'Restart=always',
      'RestartSec=15',
      'KillSignal=SIGINT',
      'TimeoutStopSec=5min',
      ...hardening,
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      '',
    ].join('\n'), '0644'))
  }

  const hooksDir = `${dir}/${HOOKS_DIR_NAME}`
  for (const phase of ['started', 'completed'] as const) {
    steps.push(fileStep(
      `hook-${phase}`,
      `Write the job-${phase} hook (memory peak, OOM kills, swap, load per job)`,
      `${hooksDir}/job-${phase}.sh`,
      hookScript({ phase, endpoint: input.endpoint, hostId: input.hostId }),
      '0755',
      `${ru}:${ru}`,
    ))
  }
  steps.push({
    id: 'hook-key',
    title: `Save the Mushi API key for the hooks (${hooksDir}/key, mode 0600, owned by ${ru})`,
    sudo: true,
    stdinSecret: 'api-key',
    run: `umask 077 && IFS= read -r k && printf '%s\\n' "$k" > ${q(`${hooksDir}/key`)} && chown ${ru}:${ru} ${q(`${hooksDir}/key`)}`,
  })
  steps.push({
    id: 'hook-env',
    title: "Turn the hooks on in the runner's .env",
    sudo: true,
    run: [
      `cd ${q(dir)}`,
      `grep -q '^${HOOK_ENV_STARTED}=' .env 2>/dev/null || echo '${HOOK_ENV_STARTED}=${hooksDir}/job-started.sh' >> .env`,
      `grep -q '^${HOOK_ENV_COMPLETED}=' .env 2>/dev/null || echo '${HOOK_ENV_COMPLETED}=${hooksDir}/job-completed.sh' >> .env`,
      `chown ${ru}:${ru} .env`,
    ].join(' && '),
  })

  steps.push({
    id: 'heartbeat-env',
    title: `Save the Mushi API key for the heartbeat (${ETC_DIR}/heartbeat.env, root only)`,
    sudo: true,
    stdinSecret: 'api-key',
    run: `install -d -m 0700 ${ETC_DIR} && umask 077 && IFS= read -r k && printf 'MUSHI_API_KEY=%s\\nMUSHI_API_ENDPOINT=%s\\n' "$k" ${q(input.endpoint)} > ${ETC_DIR}/heartbeat.env`,
  })
  steps.push(fileStep('heartbeat-service', 'Write the heartbeat service (runs as you, reads systemd and cgroups only)', `${UNIT_DIR}/mushi-runner-heartbeat.service`, [
    '[Unit]',
    'Description=Mushi runner heartbeat (memory, swap, load, runner services)',
    'After=network-online.target',
    '',
    '[Service]',
    'Type=oneshot',
    `User=${input.installUser}`,
    `EnvironmentFile=${ETC_DIR}/heartbeat.env`,
    `ExecStart=${systemdArgv(input.heartbeatCommand)}`,
    'NoNewPrivileges=yes',
    '',
  ].join('\n'), '0644'))
  steps.push(fileStep('heartbeat-timer', 'Send the heartbeat every 2 minutes', `${UNIT_DIR}/mushi-runner-heartbeat.timer`, [
    '[Unit]',
    'Description=Mushi runner heartbeat every 2 minutes',
    '',
    '[Timer]',
    'OnBootSec=1min',
    'OnUnitActiveSec=2min',
    '',
    '[Install]',
    'WantedBy=timers.target',
    '',
  ].join('\n'), '0644'))

  const enable = [unit, 'mushi-runner-heartbeat.timer']
  if (input.blockLan) {
    const nftPath = `${ETC_DIR}/egress-${input.uid}.nft`
    steps.push({
      id: 'egress-check',
      title: 'Check that nftables is installed',
      sudo: true,
      run: "command -v nft >/dev/null 2>&1 || { echo 'nftables is not installed: install it (for example sudo apt install nftables) or drop --block-lan' >&2; exit 1; }",
    })
    steps.push(fileStep('egress-rules', `Block the ${ru} user from your LAN and tailnet (nftables table of its own)`, nftPath, egressRules(input.uid, input.resolvers), '0644'))
    steps.push(fileStep('egress-service', 'Load those rules at boot', `${UNIT_DIR}/mushi-runner-egress.service`, [
      '[Unit]',
      'Description=Mushi runner egress block (LAN, tailnet, link-local)',
      'Before=network-pre.target',
      'Wants=network-pre.target',
      '',
      '[Service]',
      'Type=oneshot',
      'RemainAfterExit=yes',
      `ExecStart=/usr/sbin/nft -f ${nftPath}`,
      `ExecStop=/usr/sbin/nft delete table inet mushi_runner_egress_${input.uid}`,
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      '',
    ].join('\n'), '0644'))
    enable.unshift('mushi-runner-egress.service')
  }

  steps.push({
    id: 'enable',
    title: 'Start the runner and the heartbeat',
    sudo: true,
    run: `systemctl daemon-reload && systemctl enable --now ${enable.join(' ')}`,
  })

  if (input.setVariable) {
    steps.push({
      id: 'variable',
      title: `Set LINUX_RUNNER=${input.label} on ${input.repo} (your gh login)`,
      sudo: false,
      run: `gh variable set LINUX_RUNNER --repo ${input.repo} --body ${input.label}`,
    })
  }

  const notes = [
    ...notesForWorkflows(input.label, input.setVariable, input.repo),
    `Check it: mushi runner status (and journalctl -u ${unit} -f on this machine).`,
    'Stronger isolation (a fresh container per job) is not set up by this command yet; until then keep this runner on private repos you trust.',
  ]
  if (input.platform === 'wsl2') notes.push(...wslNotes(input.wsl?.distro ?? null))
  return { refused: null, steps, warnings, notes }
}

/** argv as a systemd ExecStart line: % doubled, arguments with spaces or quotes double-quoted. */
export function systemdArgv(argv: string[]): string {
  return argv
    .map((a) => a.replace(/%/g, '%%'))
    .map((a) => (/[\s"'\\]/.test(a) ? `"${a.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : a))
    .join(' ')
}

function memoryHigh(max: string): string {
  const n = Number(max.slice(0, -1))
  const unit = max.slice(-1)
  const mb = unit === 'G' ? n * 1024 : n
  return `${Math.floor(mb * 0.9)}M`
}

/**
 * nftables rules that keep one uid off private networks. Its own table, made
 * idempotent with `table … {}` + `delete table …`; never `flush ruleset`.
 */
export function egressRules(uid: number, resolvers: string[]): string {
  const table = `mushi_runner_egress_${uid}`
  // WSL's DNS proxy, and whatever the system resolver is.
  const dns = [...new Set(['10.255.255.254', ...resolvers])].filter((ip) => !ip.startsWith('127.'))
  return [
    '#!/usr/sbin/nft -f',
    `# Mushi runner egress block for uid ${uid}. Its own table; other rules are untouched.`,
    `define MUSHI_RUNNER_UID = ${uid}`,
    `table inet ${table} {}`,
    `delete table inet ${table}`,
    `table inet ${table} {`,
    '  chain output {',
    '    type filter hook output priority 0; policy accept;',
    '    meta skuid $MUSHI_RUNNER_UID oif lo accept',
    ...(dns.length ? [`    meta skuid $MUSHI_RUNNER_UID ip daddr { ${dns.join(', ')} } meta l4proto { tcp, udp } th dport 53 accept`] : []),
    '    meta skuid $MUSHI_RUNNER_UID ip daddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10, 169.254.0.0/16 } reject',
    '    meta skuid $MUSHI_RUNNER_UID ip6 daddr { fc00::/7, fe80::/10 } reject',
    '  }',
    '}',
    '',
  ].join('\n')
}
