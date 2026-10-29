import { describe, expect, it } from 'vitest'
import { freshEyesEnv, freshEyesOutcome, freshEyesStdin, runFreshEyesClaim } from './fresh-eyes.js'
import type { FreshEyesTarget } from './protocol.js'

const PASSWORD = 'test-fixture-not-a-real-password'
const target = (over: Partial<FreshEyesTarget> = {}): FreshEyesTarget => ({
  runId: '20261028-090000-ab12',
  url: 'https://glot.it/',
  goal: 'sign up & pick a language; "fast"',
  sessions: 2,
  successText: null,
  dryRun: false,
  accounts: [{ email: 'fresh-eyes-abc@synthetic.kensaur.us', password: PASSWORD, name: 'Fresh Eyes' }],
  ...over,
})
const proc = (over: Partial<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> = {}) => ({ code: 0, stdout: '', stderr: '', timedOut: false, ...over })

describe('a first-time user test on this machine (ADR 0053 amendment)', () => {
  it('starts mushi-ux with fixed arguments and no shell; the run, its goal and accounts go on stdin', async () => {
    const seen: Array<{ cmd: string; argv: readonly string[]; input?: string; env?: NodeJS.ProcessEnv }> = []
    const out = await runFreshEyesClaim(target(), {
      projectId: 'p1',
      apiKey: 'mushi_worker123456',
      endpoint: 'https://api.test',
      signal: new AbortController().signal,
      log: () => {},
      env: { MUSHI_UX_BIN: '/repo/packages/ux/dist/cli.js', PATH: '/usr/bin' },
      run: async (cmd, argv, o) => {
        seen.push({ cmd, argv, input: o?.input, env: o?.env })
        return proc({ stdout: 'Synced\n1 of 2 session(s) reached the goal; time to first value 61 s; 9 step(s) (median).\n' })
      },
    })
    expect(out).toEqual({ result: 'ran', detail: '1 of 2 session(s) reached the goal; time to first value 61 s; 9 step(s) (median).' })
    expect(seen[0]!.cmd).toBe(process.execPath)
    expect(seen[0]!.argv).toEqual(['/repo/packages/ux/dist/cli.js', 'fresh-eyes', '--request-stdin', '--sync', '--file'])
    // Nothing the server chose is in argv.
    expect(seen[0]!.argv.join(' ')).not.toContain('glot.it')
    expect(seen[0]!.argv.join(' ')).not.toContain(PASSWORD)
    expect(JSON.parse(seen[0]!.input!)).toMatchObject({ runId: '20261028-090000-ab12', goal: 'sign up & pick a language; "fast"', accounts: [{ password: PASSWORD }] })
    expect(seen[0]!.env).toMatchObject({ MUSHI_API_KEY: 'mushi_worker123456', MUSHI_PROJECT_ID: 'p1', MUSHI_API_ENDPOINT: 'https://api.test' })
  })

  it('a look-around run files nothing', async () => {
    let argv: readonly string[] = []
    await runFreshEyesClaim(target({ dryRun: true, accounts: [] }), {
      projectId: 'p1', apiKey: 'k', endpoint: 'e', signal: new AbortController().signal, log: () => {},
      env: { MUSHI_UX_BIN: '/x/cli.js' },
      run: async (_c, a) => { argv = a; return proc() },
    })
    expect(argv).toContain('--dry-run')
    expect(argv).not.toContain('--file')
  })

  it('passes no other Mushi credential to the child', () => {
    const env = freshEyesEnv({ PATH: '/bin', MUSHI_WORKER_KEY: 'mushi_secret', MUSHI_API_KEY: 'mushi_cli', MUSHI_UX_BIN: '/x', MUSHI_FRESH_EYES_PASSWORD: 'p' }, { apiKey: 'mushi_w', projectId: 'p1', endpoint: 'e' })
    expect(env).toEqual({ PATH: '/bin', MUSHI_UX_BIN: '/x', MUSHI_API_KEY: 'mushi_w', MUSHI_PROJECT_ID: 'p1', MUSHI_API_ENDPOINT: 'e' })
  })

  it('says how it ended: could not start, timed out, failed, stopped', () => {
    expect(freshEyesOutcome(proc({ code: null, stderr: 'spawn ENOENT' }), false)).toMatchObject({ result: 'failed', failureKind: 'infra' })
    expect(freshEyesOutcome(proc({ timedOut: true, code: null }), false)).toMatchObject({ result: 'timeout' })
    expect(freshEyesOutcome(proc({ code: 1, stderr: 'Console sync failed: NO_WORK_CLAIM' }), false)).toMatchObject({ result: 'failed', detail: 'Console sync failed: NO_WORK_CLAIM' })
    expect(freshEyesOutcome(proc({ code: null }), true).result).toBe('stopped')
    expect(freshEyesOutcome(proc({ stdout: 'no summary' }), false)).toEqual({ result: 'ran', detail: 'The test finished and synced.' })
  })

  it('the stdin document holds only the run', () => {
    expect(Object.keys(JSON.parse(freshEyesStdin(target())))).toEqual(['runId', 'url', 'goal', 'sessions', 'successText', 'dryRun', 'accounts'])
  })
})
