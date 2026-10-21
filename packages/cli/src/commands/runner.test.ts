import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { errorReply, okReply, runCli, TEST_API_KEY, TEST_PROJECT_ID } from '../test-harness.js'
import type { GhExec } from '../runner/github.js'
import type { HostIO } from '../runner/host.js'
import { __setRunnerDeps, registerRunnerCommands } from './runner.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return {
    ...actual,
    loadConfig: () => ({ apiKey: 'mushi_test_key_0123', endpoint: 'https://api.test/functions/v1/api', projectId: '11111111-2222-4333-8444-555555555555' }), // gitleaks:allow — fake key for the CLI test harness
  }
})

const UNIT = 'actions.runner.acme-api.ci-1.service'

function fakeHost(files: Record<string, string> = {}): HostIO {
  const all: Record<string, string> = {
    '/proc/version': 'Linux version 6.8.0-45-generic',
    '/etc/machine-id': 'raw-machine-id-1234\n',
    '/proc/meminfo': 'MemTotal: 16777216 kB\nMemAvailable: 8388608 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n',
    '/proc/loadavg': '1.00 1.00 1.00 1/1 1\n',
    ...files,
  }
  return {
    platform: 'linux',
    readFile: (p) => all[p] ?? null,
    exec: (cmd, args) => {
      const line = [cmd, ...args].join(' ')
      if (line.startsWith('systemctl list-units')) return `${UNIT} loaded active running GitHub Actions Runner\n`
      if (line.startsWith(`systemctl show ${UNIT}`)) return 'ActiveState=active\nNRestarts=0\nControlGroup=/system.slice/x.service\n'
      return null
    },
    diskFreeBytes: () => 50 * 1024 ** 3,
    cpuCount: 4,
    totalMemBytes: 16 * 1024 ** 3,
    freeMemBytes: 8 * 1024 ** 3,
    load1: 1,
    hostname: 'ci-box',
  }
}

/** A gh that answers from a table keyed by the joined argv. */
function fakeGh(table: Record<string, string | Error>): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = []
  const gh: GhExec = (args) => {
    calls.push(args)
    const hit = table[args.join(' ')]
    if (hit === undefined) return { ok: false, error: 'HTTP 404: Not Found' }
    if (hit instanceof Error) return { ok: false, error: hit.message }
    return { ok: true, stdout: hit }
  }
  return { gh, calls }
}

/** A runner:write key, different from the CLI key (TEST_API_KEY, which may hold mcp:write). */
const RUNNER_KEY = 'mushi_runner_key_fake_0001' // gitleaks:allow — fake key for the CLI test harness
const MINT_PATH = `/v1/admin/projects/${TEST_PROJECT_ID}/runner-key`
const mintReply = (call: { path: string }) => (call.path === MINT_PATH ? okReply({ key: RUNNER_KEY, label: 'runner:ci-box' }) : okReply({ status: 'ok' }))

let restore: (() => void) | null = null
let tmp: string | null = null
beforeEach(() => {
  vi.stubEnv('MUSHI_RUNNER_KEY', '')
  vi.stubEnv('CREDENTIALS_DIRECTORY', '')
  restore = __setRunnerDeps({ host: fakeHost(), systemdRunning: () => true, ghAuthText: () => 'Logged in to github.com account acme (/home/u/.config/gh/hosts.yml)' })
})
afterEach(() => {
  restore?.()
  vi.unstubAllEnvs()
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
})

describe('mushi runner status', () => {
  it('reads the configured project for 7 days and prints the overview', async () => {
    const run = await runCli(registerRunnerCommands, ['runner', 'status'], () => okReply({
      window: { days: 7 }, hosts: [], runners: [{ name: 'ci-1', repo: 'acme/api', status: 'online', busy: false }],
      stats: { queueP50s: 5, queueP95s: 30, durationP50s: 120, durationP95s: 300, passRate: 1, infraFailures: 0, codeFailures: 0 }, advice: [],
    }))
    expect(run.calls[0]!.path).toBe(`/v1/admin/ci/overview?project_id=${TEST_PROJECT_ID}&days=7`)
    expect(run.stdout).toMatch(/ONLINE\s+ci-1\s+acme\/api/)
    expect(run.stdout).toContain('0 where the test machine stopped')
  })

  it('--all leaves the project out (portfolio map), and --json prints the payload', async () => {
    const run = await runCli(registerRunnerCommands, ['runner', 'status', '--all', '--days', '14', '--refresh', '--json'], () => okReply({ hosts: [], advice: [] }))
    expect(run.calls[0]!.path).toBe('/v1/admin/ci/overview?days=14&refresh=1')
    expect(JSON.parse(run.stdout)).toEqual({ hosts: [], advice: [] })
  })

  it('accepts --project and rejects a bad window', async () => {
    const other = '22222222-3333-4444-8555-666666666666'
    const run = await runCli(registerRunnerCommands, ['runner', 'status', '--project', other], () => okReply({}))
    expect(run.calls[0]!.path).toContain(`project_id=${other}`)
    const bad = await runCli(registerRunnerCommands, ['runner', 'status', '--days', '90'])
    expect(bad.error?.message).toMatch(/1 to 30/)
    expect(bad.calls).toEqual([])
  })
})

describe('mushi runner heartbeat', () => {
  it('--dry-run prints the body and sends nothing; the raw machine id never appears', async () => {
    const run = await runCli(registerRunnerCommands, ['runner', 'heartbeat', '--dry-run'])
    expect(run.calls).toEqual([])
    const body = JSON.parse(run.stdout)
    expect(body.kind).toBe('heartbeat')
    expect(body.host.host_id).toMatch(/^[0-9a-f]{64}$/)
    expect(body.runners).toEqual([expect.objectContaining({ name: 'ci-1', repo: 'acme/api', service: UNIT, active: true })])
    expect(run.stdout).not.toContain('raw-machine-id')
  })

  it('--once posts one heartbeat with the runner key, never the CLI key', async () => {
    vi.stubEnv('MUSHI_RUNNER_KEY', RUNNER_KEY)
    const run = await runCli(registerRunnerCommands, ['runner', 'heartbeat', '--once'], () => okReply({ status: 'ok' }))
    expect(run.calls).toHaveLength(1)
    expect(run.calls[0]!.method).toBe('POST')
    expect(run.calls[0]!.path).toBe('/v1/ingest/runner')
    expect(run.calls[0]!.headers['X-Mushi-Api-Key']).toBe(RUNNER_KEY)
    expect(JSON.stringify(run.calls[0]!.headers)).not.toContain(TEST_API_KEY)
    expect((run.calls[0]!.body as { kind: string }).kind).toBe('heartbeat')
    expect(run.stdout).toContain('Sent a heartbeat for ci-box with 1 runner(s).')
  })

  it('reads the key from the systemd credential, then the default file', async () => {
    vi.stubEnv('CREDENTIALS_DIRECTORY', '/run/credentials/mushi-runner-heartbeat.service')
    __setRunnerDeps({ host: fakeHost({ '/run/credentials/mushi-runner-heartbeat.service/runner-key': `${RUNNER_KEY}\n` }) })
    const fromCred = await runCli(registerRunnerCommands, ['runner', 'heartbeat', '--once'], () => okReply({}))
    expect(fromCred.calls[0]!.headers['X-Mushi-Api-Key']).toBe(RUNNER_KEY)
    vi.stubEnv('CREDENTIALS_DIRECTORY', '')
    __setRunnerDeps({ host: fakeHost({ '/etc/mushi/runner.key': `${RUNNER_KEY}\n` }) })
    const fromFile = await runCli(registerRunnerCommands, ['runner', 'heartbeat', '--once'], () => okReply({}))
    expect(fromFile.calls[0]!.headers['X-Mushi-Api-Key']).toBe(RUNNER_KEY)
  })

  it('refuses without a runner key, and refuses the CLI key passed as one', async () => {
    const none = await runCli(registerRunnerCommands, ['runner', 'heartbeat', '--once'])
    expect(none.error?.message).toMatch(/No runner key/)
    expect(none.calls).toEqual([])
    vi.stubEnv('MUSHI_RUNNER_KEY', TEST_API_KEY)
    const cli = await runCli(registerRunnerCommands, ['runner', 'heartbeat', '--once'])
    expect(cli.error?.message).toMatch(/That is your CLI key/)
    expect(cli.calls).toEqual([])
  })

  it('--once exits non-zero when the server refuses', async () => {
    vi.stubEnv('MUSHI_RUNNER_KEY', RUNNER_KEY)
    const run = await runCli(registerRunnerCommands, ['runner', 'heartbeat', '--once'], () => errorReply(429, 'RATE_LIMITED', 'slow down'))
    expect(run.exitCode).toBe(1)
    expect(run.stderr).toContain('RATE_LIMITED')
  })
})

describe('mushi runner key', () => {
  it('creates a runner key with the CLI key and saves it 0600 without printing it', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'mushi-key-'))
    const out = join(tmp, 'runner.key')
    const run = await runCli(registerRunnerCommands, ['runner', 'key', '--out', out, '--label', 'runner-nuc'], mintReply)
    expect(run.calls).toEqual([expect.objectContaining({ method: 'POST', path: MINT_PATH, body: { label: 'runner-nuc' } })])
    expect(run.calls[0]!.headers['X-Mushi-Api-Key']).toBe(TEST_API_KEY)
    expect(readFileSync(out, 'utf8')).toBe(`${RUNNER_KEY}\n`)
    expect(statSync(out).mode & 0o777).toBe(0o600)
    expect(run.stdout + run.stderr).not.toContain(RUNNER_KEY)
  })

  it('explains the scope needed when the CLI key cannot mint', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'mushi-key-'))
    const run = await runCli(registerRunnerCommands, ['runner', 'key', '--out', join(tmp, 'k')], () => errorReply(403, 'INSUFFICIENT_SCOPE', 'needs mcp:write'))
    expect(run.error?.message).toMatch(/Could not create a runner key/)
    expect(run.error?.hint ?? '').toMatch(/--upgrade-scope/)
    expect(existsSync(join(tmp, 'k'))).toBe(false)
  })

  it('refuses a server answer that is the CLI key itself', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'mushi-key-'))
    const run = await runCli(registerRunnerCommands, ['runner', 'key', '--out', join(tmp, 'k')], () => okReply({ key: TEST_API_KEY }))
    expect(run.error?.message).toMatch(/That is your CLI key/)
    expect(existsSync(join(tmp, 'k'))).toBe(false)
  })
})

describe('mushi runner hooks install', () => {
  function runnerDir(env = ''): string {
    tmp = mkdtempSync(join(tmpdir(), 'mushi-runner-'))
    writeFileSync(join(tmp, 'config.sh'), '#!/bin/sh\n')
    if (env) writeFileSync(join(tmp, '.env'), env)
    return tmp
  }

  it('writes both hooks, a 0600 runner key file (never the CLI key) and the .env lines, idempotently', async () => {
    const dir = runnerDir('LANG=C.UTF-8\n')
    const run = await runCli(registerRunnerCommands, ['runner', 'hooks', 'install', '--dir', dir], mintReply)
    expect(run.exitCode).toBe(0)
    expect(run.calls.map((c) => c.path)).toEqual([MINT_PATH])
    for (const phase of ['started', 'completed']) {
      const script = readFileSync(join(dir, 'mushi-hooks', `job-${phase}.sh`), 'utf8')
      expect(script).toContain(`PHASE=${phase}`)
      // The hook never carries a key inline.
      expect(script).not.toContain(TEST_API_KEY)
      expect(script).not.toContain(RUNNER_KEY)
    }
    const keyFile = readFileSync(join(dir, 'mushi-hooks', 'key'), 'utf8')
    expect(keyFile).toBe(`${RUNNER_KEY}\n`)
    expect(keyFile).not.toContain(TEST_API_KEY)
    expect(statSync(join(dir, 'mushi-hooks', 'key')).mode & 0o777).toBe(0o600)
    const env = readFileSync(join(dir, '.env'), 'utf8')
    expect(env).toContain(`ACTIONS_RUNNER_HOOK_JOB_STARTED=${join(dir, 'mushi-hooks', 'job-started.sh')}`)
    expect(run.stdout).not.toContain(TEST_API_KEY)
    expect(run.stdout).not.toContain(RUNNER_KEY)
    expect(run.stdout).toContain('Restart the runner service')
    await runCli(registerRunnerCommands, ['runner', 'hooks', 'install', '--dir', dir], mintReply)
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(env)
  })

  it('uses MUSHI_RUNNER_KEY without minting, and refuses the CLI key there', async () => {
    const dir = runnerDir()
    vi.stubEnv('MUSHI_RUNNER_KEY', RUNNER_KEY)
    const run = await runCli(registerRunnerCommands, ['runner', 'hooks', 'install', '--dir', dir])
    expect(run.calls).toEqual([])
    expect(readFileSync(join(dir, 'mushi-hooks', 'key'), 'utf8')).toBe(`${RUNNER_KEY}\n`)
    const dir2 = runnerDir()
    vi.stubEnv('MUSHI_RUNNER_KEY', TEST_API_KEY)
    const refused = await runCli(registerRunnerCommands, ['runner', 'hooks', 'install', '--dir', dir2])
    expect(refused.error?.message).toMatch(/That is your CLI key/)
    expect(existsSync(join(dir2, 'mushi-hooks', 'key'))).toBe(false)
  })

  it('refuses to replace another hook without --force, and --dry-run writes nothing', async () => {
    const dir = runnerDir('ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/cleanup.sh\n')
    const refused = await runCli(registerRunnerCommands, ['runner', 'hooks', 'install', '--dir', dir])
    expect(refused.error?.message).toMatch(/already sets a job hook/)
    expect(existsSync(join(dir, 'mushi-hooks'))).toBe(false)
    const dry = await runCli(registerRunnerCommands, ['runner', 'hooks', 'install', '--dir', dir, '--force', '--dry-run'])
    expect(dry.stdout).toContain('Would write')
    expect(dry.stdout).toContain('not shown')
    expect(existsSync(join(dir, 'mushi-hooks'))).toBe(false)
  })

  it('refuses a folder that is not a runner', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'mushi-runner-'))
    const run = await runCli(registerRunnerCommands, ['runner', 'hooks', 'install', '--dir', tmp])
    expect(run.error?.message).toMatch(/does not look like a runner folder/)
  })
})

describe('mushi runner add', () => {
  const SHA = 'd'.repeat(64)
  const release = JSON.stringify({ tag_name: 'v2.329.0', body: `<!-- BEGIN SHA linux-x64 -->${SHA}<!-- END SHA linux-x64 -->` })

  it('--dry-run prints the plan, runs nothing and never shows the key', async () => {
    const { gh } = fakeGh({
      'api repos/acme/api --jq .private': 'true\n',
      'api repos/acme/api/actions/permissions/fork-pr-contributor-approval --jq .approval_policy': 'all_external_contributors\n',
      'api repos/acme/api/contents/.github/workflows --jq .[] | select(.type == "file") | .path': '',
      'api repos/actions/runner/releases/latest': release,
    })
    const runStep = vi.fn(() => 0)
    const undo = __setRunnerDeps({ gh, runStep })
    try {
      const run = await runCli(registerRunnerCommands, ['runner', 'add', '--repo', 'acme/api', '--label', 'mushi-ci', '--memory', '8G', '--dry-run'])
      expect(run.exitCode).toBe(0)
      expect(runStep).not.toHaveBeenCalled()
      expect(run.stdout).toContain('Download actions/runner 2.329.0 and check its SHA-256')
      expect(run.stdout).toContain('$ sudo sh -c')
      expect(run.stdout).toContain('(stdin: the runner key (runner:write), not shown)')
      expect(run.calls.filter((c) => c.path === MINT_PATH)).toEqual([])
      expect(run.stdout).toContain('runs-on: [self-hosted, mushi-ci]')
      expect(run.stdout).toContain('Dry run: nothing was changed.')
      expect(run.stdout).not.toContain(TEST_API_KEY)
    } finally {
      undo()
    }
  })

  it('refuses a public repo before running anything', async () => {
    const { gh } = fakeGh({ 'api repos/acme/site --jq .private': 'false\n', 'api repos/actions/runner/releases/latest': release })
    const runStep = vi.fn(() => 0)
    const undo = __setRunnerDeps({ gh, runStep })
    try {
      const run = await runCli(registerRunnerCommands, ['runner', 'add', '--repo', 'acme/site', '--yes'])
      expect(run.error?.message).toMatch(/is public/)
      expect(runStep).not.toHaveBeenCalled()
    } finally {
      undo()
    }
  })

  it('--yes runs every step and pipes the key on stdin only to the steps that need it', async () => {
    const { gh } = fakeGh({
      'api repos/acme/api --jq .private': 'true\n',
      'api repos/actions/runner/releases/latest': release,
    })
    const seen: Array<{ id: string; stdin: string | undefined }> = []
    const undo = __setRunnerDeps({ gh, runStep: (step, stdin) => { seen.push({ id: step.id, stdin }); return 0 } })
    try {
      const run = await runCli(registerRunnerCommands, ['runner', 'add', '--repo', 'acme/api', '--label', 'mushi-ci', '--memory', '8G', '--yes'], mintReply)
      expect(run.exitCode).toBe(0)
      expect(seen.map((s) => s.id)).toContain('enable')
      // One runner key, minted once, goes only to the two key steps.
      expect(run.calls.filter((c) => c.path === MINT_PATH).map((c) => c.body)).toEqual([{ label: 'ci-box' }])
      expect(seen.filter((s) => s.stdin?.includes(RUNNER_KEY)).map((s) => s.id)).toEqual(['hook-key', 'heartbeat-key'])
      // The CLI key never reaches the machine: no step gets it on stdin.
      expect(seen.filter((s) => s.stdin?.includes(TEST_API_KEY))).toEqual([])
      expect(run.stdout).not.toContain(TEST_API_KEY)
      expect(run.stdout).not.toContain(RUNNER_KEY)
      expect(run.stdout).toContain('Done.')
    } finally {
      undo()
    }
  })

  it('stops at the first failing step', async () => {
    const { gh } = fakeGh({ 'api repos/acme/api --jq .private': 'true\n', 'api repos/actions/runner/releases/latest': release })
    const seen: string[] = []
    const undo = __setRunnerDeps({ gh, runStep: (step) => { seen.push(step.id); return step.id === 'download' ? 1 : 0 } })
    try {
      const run = await runCli(registerRunnerCommands, ['runner', 'add', '--repo', 'acme/api', '--label', 'mushi-ci', '--memory', '8G', '--yes'], mintReply)
      expect(run.error?.message).toMatch(/Step 2 \(download\) failed/)
      expect(seen).toEqual(['user', 'download'])
    } finally {
      undo()
    }
  })
})

describe('mushi runner audit', () => {
  it('lists runners and flags a backdoor-named one with exit code 1', async () => {
    const { gh } = fakeGh({
      'api --paginate repos/acme/api/actions/runners --jq .runners[]': [
        JSON.stringify({ id: 1, name: 'mushi-ci-1', status: 'online', busy: false, labels: [{ name: 'mushi-ci' }] }),
        JSON.stringify({ id: 2, name: 'SHA1HULUD', status: 'online', busy: false, labels: [{ name: 'self-hosted' }] }),
      ].join('\n'),
      'api repos/acme/api/actions/permissions/fork-pr-contributor-approval --jq .approval_policy': 'all_external_contributors\n',
      'api repos/acme/api --jq .private': 'true\n',
    })
    const undo = __setRunnerDeps({ gh })
    try {
      const run = await runCli(registerRunnerCommands, ['runner', 'audit', '--repo', 'acme/api'], () => okReply({ hosts: [] }))
      expect(run.stdout).toContain('mushi-ci-1  [mushi-ci]  (Mushi)')
      expect(run.stdout).toMatch(/CRITICAL\s+Runner "SHA1HULUD"/)
      expect(run.exitCode).toBe(1)
    } finally {
      undo()
    }
  })
})
