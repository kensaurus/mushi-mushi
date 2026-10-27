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

describe('mushi runner compare', () => {
  const COMPARE = {
    window: { days: 30 }, dataDays: 2.1, lowConfidence: true, source: 'sql', sourceNote: null,
    rates: { fetchedAt: '2026-10-22', usdPerMinute: { linux: 0.006, windows: 0.01, macos: 0.062 } },
    repos: [{ repo: 'acme/api', visibility: 'private' }],
    rows: [{ repo: 'acme/api', runnerClass: 'github_hosted', labels: ['ubuntu-latest'], jobs: 12, queueP95s: 3, runP50s: 220, prPassRate: 0.9, billedMinutes: 48, monthCost: 4.5, costBasis: 'github_list', currency: 'USD' }],
    accounts: [], machines: [], speed: [], whatIfs: [], advice: [],
  }

  it('reads the configured project for 30 days and prints estimated costs with the price date', async () => {
    const run = await runCli(registerRunnerCommands, ['runner', 'compare'], () => okReply(COMPARE))
    expect(run.calls[0]!.path).toBe(`/v1/admin/ci/compare?project_id=${TEST_PROJECT_ID}&days=30`)
    expect(run.calls[0]!.method ?? 'GET').toBe('GET')
    expect(run.stdout).toContain('Low confidence')
    expect(run.stdout).toContain('GitHub list prices from 2026-10-22')
    expect(run.stdout).toMatch(/acme\/api \(private\)\s+GitHub-hosted \(ubuntu-latest\)/)
    expect(run.stdout).toContain('$4.50')
  })

  it('--all --json prints the payload; a bad window is refused before any call', async () => {
    const run = await runCli(registerRunnerCommands, ['runner', 'compare', '--all', '--days', '7', '--json'], () => okReply(COMPARE))
    expect(run.calls[0]!.path).toBe('/v1/admin/ci/compare?days=7')
    expect(JSON.parse(run.stdout)).toEqual(COMPARE)
    const bad = await runCli(registerRunnerCommands, ['runner', 'compare', '--days', '0'])
    expect(bad.error?.message).toMatch(/1 to 30/)
    expect(bad.calls).toEqual([])
  })
})

describe('mushi runner bill', () => {
  const USAGE = {
    usageItems: [
      { date: '2026-10-01T00:47:27Z', product: 'actions', sku: 'Actions Linux', quantity: 100, unitType: 'Minutes', grossAmount: 0.6, discountAmount: 0, netAmount: 0.6, repositoryName: 'api' },
      { date: '2026-10-01T00:00:00Z', product: 'copilot', sku: 'Copilot Premium Request', quantity: 3, unitType: 'requests', grossAmount: 0.12, discountAmount: 0, netAmount: 0.12 },
    ],
  }
  const github = (call: { path: string }) => {
    if (call.path === 'https://api.github.com/user') return { body: { login: 'acme' } }
    if (call.path === 'https://api.github.com/users/acme') return { body: { type: 'User' } }
    if (call.path.startsWith('https://api.github.com/users/acme/settings/billing/usage')) return { body: USAGE }
    if (call.path === '/v1/admin/ci/bill') return okReply({ owner: 'acme', month: '2026-10', rows: 1, netUsd: 0.6 })
    return { status: 404, body: {} }
  }

  it('reads the month with GITHUB_TOKEN, prints net per repo, and never sends the token to Mushi', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_fake_bill_token')
    const run = await runCli(registerRunnerCommands, ['runner', 'bill', '--month', '2026-10'], github)
    expect(run.error).toBeNull()
    expect(run.calls.map((c) => c.path)).toEqual([
      'https://api.github.com/user',
      'https://api.github.com/users/acme',
      'https://api.github.com/users/acme/settings/billing/usage?year=2026&month=10',
    ])
    expect(run.calls[0]!.headers.Authorization).toBe('Bearer ghp_fake_bill_token')
    expect(run.stdout).toContain('GitHub Actions bill for acme, 2026-10')
    expect(run.stdout).toMatch(/acme\/api\s+\$0\.60 net/)
    expect(run.stdout).not.toContain('ghp_fake_bill_token')
    expect(run.stdout).toContain('--push')
  })

  it('--push uploads only the Actions items to the configured project; gh auth token is the fallback', async () => {
    vi.stubEnv('GITHUB_TOKEN', '')
    const { gh, calls } = fakeGh({ 'auth token': 'gho_from_gh\n' })
    restore?.()
    restore = __setRunnerDeps({ host: fakeHost(), gh })
    const run = await runCli(registerRunnerCommands, ['runner', 'bill', '--month', '2026-10', '--push', '--json'], github)
    expect(calls).toEqual([['auth', 'token']])
    const push = run.calls.find((c) => c.path === '/v1/admin/ci/bill')!
    expect(push.method).toBe('POST')
    expect(push.body).toMatchObject({ projectId: TEST_PROJECT_ID, owner: 'acme', ownerType: 'User', year: 2026, month: 10 })
    expect((push.body as { items: unknown[] }).items).toEqual([expect.objectContaining({ product: 'actions', sku: 'Actions Linux', repositoryName: 'api' })])
    expect(JSON.stringify(push.body)).not.toContain('gho_from_gh')
    expect(JSON.parse(run.stdout)).toMatchObject({ owner: 'acme', netUsd: 0.6, pushed: { rows: 1 } })
  })

  it('refuses a bad month or owner before any call, and says how to sign in without a GitHub login', async () => {
    vi.stubEnv('GITHUB_TOKEN', '')
    const bad = await runCli(registerRunnerCommands, ['runner', 'bill', '--month', '10-2026'])
    expect(bad.error?.message).toMatch(/2026-10/)
    expect(bad.calls).toEqual([])
    const owner = await runCli(registerRunnerCommands, ['runner', 'bill', '--owner', '-x'])
    expect(owner.error?.message).toMatch(/GitHub user or organization/)
    restore?.()
    restore = __setRunnerDeps({ host: fakeHost(), gh: fakeGh({}).gh })
    const none = await runCli(registerRunnerCommands, ['runner', 'bill'])
    expect(none.error?.message).toMatch(/No GitHub login/)
    expect(none.calls).toEqual([])
  })
})

describe('mushi runner placement', () => {
  const REQ = '33333333-4444-4555-8666-777777777777'

  it('show reads the configured project', async () => {
    const run = await runCli(registerRunnerCommands, ['runner', 'placement', 'show'], () => okReply({ policy: null, repos: [] }))
    expect(run.calls[0]!.path).toBe(`/v1/admin/ci/placement?project_id=${TEST_PROJECT_ID}`)
    expect(run.stdout).toContain('Where CI runs')
  })

  it('preview POSTs the change and changes nothing; --remove sends null', async () => {
    const preview = { repo: 'acme/api', variable: 'LINUX_RUNNER', current: { exists: false, value: null, updatedAt: null }, next: { value: 'kensaurus-local', target: { kind: 'self_hosted', label: 'kensaurus-local' } }, jobs: { moves: [], stays: [] }, warnings: [], blocked: null }
    const run = await runCli(registerRunnerCommands, ['runner', 'placement', 'preview', '--repo', 'acme/api', '--value', 'kensaurus-local'], () => okReply(preview))
    expect(run.calls[0]!.path).toBe('/v1/admin/ci/placement/preview')
    expect(run.calls[0]!.method).toBe('POST')
    expect(run.calls[0]!.body).toEqual({ projectId: TEST_PROJECT_ID, repo: 'acme/api', variable: 'LINUX_RUNNER', value: 'kensaurus-local' })
    expect(run.stdout).toContain('acme/api: vars.LINUX_RUNNER not set → “kensaurus-local”')
    const del = await runCli(registerRunnerCommands, ['runner', 'placement', 'preview', '--repo', 'acme/api', '--remove', '--variable', 'RUNNER_E2E'], () => okReply(preview))
    expect(del.calls[0]!.body).toMatchObject({ variable: 'RUNNER_E2E', value: null })
  })

  it('request asks with a reason and says who approves; bad flags are refused before any call', async () => {
    const run = await runCli(registerRunnerCommands, ['runner', 'placement', 'request', '--repo', 'acme/api', '--value', 'kensaurus-local', '--reason', 'save minutes'], () =>
      okReply({ id: REQ, status: 'pending_approval', preview: { repo: 'acme/api', variable: 'LINUX_RUNNER', next: { value: 'kensaurus-local', target: { kind: 'self_hosted', label: 'kensaurus-local' } } } }))
    expect(run.calls[0]!.path).toBe('/v1/admin/ci/placement/requests')
    expect(run.calls[0]!.body).toMatchObject({ reason: 'save minutes' })
    expect(run.stdout).toContain(`Requested ${REQ} (pending_approval)`)
    for (const argv of [
      ['runner', 'placement', 'request', '--repo', 'acme/api'],
      ['runner', 'placement', 'request', '--repo', 'acme/api', '--value', 'x', '--remove'],
      ['runner', 'placement', 'preview', '--repo', 'not-a-repo', '--value', 'x'],
    ]) {
      const bad = await runCli(registerRunnerCommands, argv)
      expect(bad.calls).toEqual([])
      expect(bad.error).toBeTruthy()
    }
  })

  it('revert asks for the reverse of a change that ran', async () => {
    const run = await runCli(registerRunnerCommands, ['runner', 'placement', 'revert', REQ], () => okReply({ id: 'new-id', status: 'pending_approval', revertOf: REQ }))
    expect(run.calls[0]!.path).toBe(`/v1/admin/ci/placement/requests/${REQ}/revert`)
    expect(run.calls[0]!.method).toBe('POST')
    expect(run.stdout).toContain(`Requested revert new-id of ${REQ}`)
  })
})

describe('mushi runner fix', () => {
  const JOB = '44444444-5555-4666-8777-888888888888'
  const job = (over: Record<string, unknown> = {}) => ({
    id: JOB,
    repo: 'acme/api',
    workflowPath: '.github/workflows/ci.yml',
    kind: 'skip_drafts',
    status: 'queued',
    summary: null,
    errorCode: null,
    error: null,
    prUrl: null,
    prNumber: null,
    monthSavingUsd: 3.5,
    baseline: null,
    measured: null,
    saving: null,
    mergedAt: null,
    closedAt: null,
    ...over,
  })
  const FIX = ['runner', 'fix', '--repo', 'acme/api', '--workflow', '.github/workflows/ci.yml', '--kind', 'skip_drafts']

  it('POSTs the fix for the configured project and says how to follow it', async () => {
    const run = await runCli(registerRunnerCommands, FIX, () => okReply({ job: job() }))
    expect(run.calls).toHaveLength(1)
    expect(run.calls[0]).toMatchObject({ method: 'POST', path: '/v1/admin/ci/cost-fixes' })
    expect(run.calls[0]!.body).toEqual({ projectId: TEST_PROJECT_ID, repo: 'acme/api', workflowPath: '.github/workflows/ci.yml', kind: 'skip_drafts' })
    expect(run.stdout).toContain('Opening a draft PR for acme/api/.github/workflows/ci.yml (skip_drafts)')
    expect(run.stdout).toContain(`mushi runner fix-status ${JOB}`)
    expect(run.stdout).toContain('Estimated saving: about $3.50 a month.')
  })

  it('--wait reads the job until the PR is open; --project picks another project', async () => {
    const OTHER = '22222222-3333-4444-8555-666666666666'
    const run = await runCli(registerRunnerCommands, [...FIX, '--wait', '--project', OTHER], (call) =>
      call.method === 'POST'
        ? okReply({ job: job() })
        : okReply({ job: job({ status: 'pr_opened', prUrl: 'https://github.com/acme/api/pull/42', prNumber: 42, summary: 'The workflow now skips drafts.' }) }),
    )
    expect(run.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /v1/admin/ci/cost-fixes', `GET /v1/admin/ci/cost-fixes/${JOB}`])
    expect(run.calls[0]!.body).toMatchObject({ projectId: OTHER })
    expect(run.stdout).toContain('Draft PR for acme/api/.github/workflows/ci.yml (skip_drafts): https://github.com/acme/api/pull/42')
    expect(run.stdout).toContain('Review it, mark it ready and merge it.')
  })

  it('refuses a bad repo, workflow path or kind before any call', async () => {
    for (const argv of [
      ['runner', 'fix', '--repo', 'acme', '--workflow', '.github/workflows/ci.yml', '--kind', 'skip_drafts'],
      ['runner', 'fix', '--repo', 'acme/api', '--workflow', 'ci.yml', '--kind', 'skip_drafts'],
      ['runner', 'fix', '--repo', 'acme/api', '--workflow', '.github/workflows/../x.yml', '--kind', 'skip_drafts'],
      ['runner', 'fix', '--repo', 'acme/api', '--workflow', '.github/workflows/ci.yml', '--kind', 'rm_rf'],
    ]) {
      const bad = await runCli(registerRunnerCommands, argv)
      expect(bad.calls).toEqual([])
      expect(bad.error?.code).toBe('E_INVALID_INPUT')
    }
  })

  it('shows the server\'s refusal, and fix-status shows the measured saving', async () => {
    const refused = await runCli(registerRunnerCommands, FIX, () => errorReply(404, 'REPO_NOT_IN_PROJECT', 'acme/api is not connected to this project.'))
    expect(refused.exitCode).toBe(1)
    expect(refused.stderr).toContain('REPO_NOT_IN_PROJECT')

    const status = await runCli(registerRunnerCommands, ['runner', 'fix-status', JOB], () =>
      okReply({
        job: job({
          status: 'pr_opened',
          prUrl: 'https://github.com/acme/api/pull/42',
          mergedAt: '2026-10-20T00:00:00Z',
          baseline: { days: 14, minutes: 280, usd: 1.68, jobs: 100 },
          saving: { minutesPerDay: 12, usdPerMonth: 2.16, measuredDays: 3 },
        }),
      }),
    )
    expect(status.calls[0]!.path).toBe(`/v1/admin/ci/cost-fixes/${JOB}`)
    expect(status.stdout).toContain('Before: about 280 billed minutes over 14 days')
    expect(status.stdout).toContain('Saved 12 billed minutes a day (about $2.16 a month), measured over 3 days.')
    expect(status.stdout).not.toContain('Review it')
  })

  it('fix-status without an id lists the configured project\'s fixes', async () => {
    const run = await runCli(registerRunnerCommands, ['runner', 'fix-status'], () => okReply({ jobs: [job({ status: 'no_change', summary: 'The workflow already skips draft pull requests.' })] }))
    expect(run.calls[0]!.path).toBe(`/v1/admin/ci/cost-fixes?project_id=${TEST_PROJECT_ID}`)
    expect(run.stdout).toContain('Nothing to change in acme/api/.github/workflows/ci.yml (skip_drafts)')
    expect(run.stdout).toContain(`job ${JOB}`)
    const none = await runCli(registerRunnerCommands, ['runner', 'fix-status'], () => okReply({ jobs: [] }))
    expect(none.stdout).toContain('No CI cost fixes yet.')
  })

  it('--json prints the job', async () => {
    const run = await runCli(registerRunnerCommands, [...FIX, '--json'], () => okReply({ job: job({ status: 'refused', error: 'no schedule' }) }))
    expect(JSON.parse(run.stdout)).toMatchObject({ id: JOB, status: 'refused' })
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
