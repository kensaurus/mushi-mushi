import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hookScript, mergeRunnerEnv } from './hooks.js'

const HOST_ID = 'a'.repeat(64)
const KEY = 'mushi_test_key_0123' // gitleaks:allow — fake key for the hook test

let tmp: string | null = null
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
})

/** Runs a hook with a fake curl that records its argv, stdin and the body. */
function runHook(phase: 'started' | 'completed', env: Record<string, string>, opts: { key?: boolean; curlFails?: boolean } = {}) {
  tmp = mkdtempSync(join(tmpdir(), 'mushi-hook-'))
  const hooks = join(tmp, 'mushi-hooks')
  const bin = join(tmp, 'bin')
  mkdirSync(hooks)
  mkdirSync(bin)
  const script = join(hooks, `job-${phase}.sh`)
  writeFileSync(script, hookScript({ phase, endpoint: 'https://api.test/functions/v1/api/', hostId: HOST_ID }), { mode: 0o755 })
  if (opts.key !== false) writeFileSync(join(hooks, 'key'), `${KEY}\n`, { mode: 0o600 })
  const log = join(tmp, 'curl.log')
  writeFileSync(join(bin, 'curl'), `#!/bin/sh
printf '%s\\n' "$@" > '${log}.argv'
cat > '${log}.stdin'
${opts.curlFails ? 'exit 7' : 'exit 0'}
`)
  chmodSync(join(bin, 'curl'), 0o755)
  const res = spawnSync('sh', [script], {
    env: { PATH: `${bin}:/usr/bin:/bin`, ...env },
    encoding: 'utf8',
  })
  const read = (p: string) => {
    try {
      return readFileSync(p, 'utf8')
    } catch {
      return null
    }
  }
  return { res, argv: read(`${log}.argv`), stdin: read(`${log}.stdin`) }
}

const GH_ENV = {
  GITHUB_REPOSITORY: 'kensaurus/glot.it',
  GITHUB_RUN_ID: '123456',
  GITHUB_RUN_ATTEMPT: '2',
  GITHUB_JOB: 'build',
  RUNNER_NAME: 'nuc-1',
}

describe('hookScript', () => {
  it('posts one job sample with the key on stdin, never in argv', () => {
    const { res, argv, stdin } = runHook('completed', GH_ENV)
    expect(res.status).toBe(0)
    expect(stdin).toBe(`X-Mushi-Api-Key: ${KEY}\n`)
    expect(argv).not.toContain(KEY)
    const lines = argv!.trim().split('\n')
    expect(lines).toContain('--max-time')
    expect(lines[lines.length - 1]).toBe('https://api.test/functions/v1/api/v1/ingest/runner')
    const body = JSON.parse(lines[lines.indexOf('--data') + 1]!)
    expect(body).toMatchObject({
      kind: 'job',
      host_id: HOST_ID,
      runner_name: 'nuc-1',
      repo: 'kensaurus/glot.it',
      run_id: 123456,
      run_attempt: 2,
      job_key: 'build',
      phase: 'completed',
    })
    expect(body.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
    for (const k of ['mem_peak_mb', 'mem_max_mb', 'oom_kills', 'swap_used_mb', 'load1']) {
      expect(body[k] === null || typeof body[k] === 'number').toBe(true)
    }
  })

  it('strips quotes and other characters from GitHub values so the JSON stays valid', () => {
    const { res, argv } = runHook('started', { ...GH_ENV, GITHUB_JOB: 'build"},"x":"y', RUNNER_NAME: 'nuc 1\\' })
    expect(res.status).toBe(0)
    const lines = argv!.trim().split('\n')
    const body = JSON.parse(lines[lines.indexOf('--data') + 1]!)
    expect(body.job_key).toBe('buildxy')
    // Spaces survive (GitHub runner names may have them); the backslash does not.
    expect(body.runner_name).toBe('nuc 1')
    expect(body.x).toBeUndefined()
  })

  it('exits 0 and sends nothing without a key, and exits 0 when curl fails', () => {
    expect(runHook('started', GH_ENV, { key: false }).res.status).toBe(0)
    expect(runHook('started', GH_ENV, { key: false }).argv).toBeNull()
    expect(runHook('completed', GH_ENV, { curlFails: true }).res.status).toBe(0)
  })

  it('does not inline the key and refuses a bad host id or endpoint', () => {
    const text = hookScript({ phase: 'started', endpoint: 'https://x.test/api', hostId: HOST_ID })
    // The only key header is the printf format fed from the key file.
    expect(text.match(/X-Mushi-Api-Key/g)).toHaveLength(1)
    expect(text).toContain(`printf 'X-Mushi-Api-Key: %s\\n' "$(cat "$HOOK_DIR/key")" | curl`)
    expect(text).toContain("--max-time 5")
    expect(text.trimEnd().endsWith('exit 0')).toBe(true)
    expect(() => hookScript({ phase: 'started', endpoint: 'https://x.test/api', hostId: 'raw-machine-id' })).toThrow()
    expect(() => hookScript({ phase: 'started', endpoint: "https://x.test/'; rm -rf /", hostId: HOST_ID })).toThrow()
  })
})

describe('mergeRunnerEnv', () => {
  const hooks = { started: '/r/mushi-hooks/job-started.sh', completed: '/r/mushi-hooks/job-completed.sh' }

  it('appends both lines once and is idempotent', () => {
    const first = mergeRunnerEnv('LANG=C.UTF-8\n', hooks)
    expect(first.text).toBe(`LANG=C.UTF-8\nACTIONS_RUNNER_HOOK_JOB_STARTED=${hooks.started}\nACTIONS_RUNNER_HOOK_JOB_COMPLETED=${hooks.completed}\n`)
    expect(mergeRunnerEnv(first.text!, hooks)).toEqual({ text: null, conflicts: [] })
  })

  it('never replaces someone else\'s hook without force', () => {
    const env = 'ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/cleanup.sh\n'
    const res = mergeRunnerEnv(env, hooks)
    expect(res.text).toBeNull()
    expect(res.conflicts).toEqual([{ key: 'ACTIONS_RUNNER_HOOK_JOB_STARTED', current: '/opt/cleanup.sh' }])
    expect(mergeRunnerEnv(env, hooks, true).text).toContain(`ACTIONS_RUNNER_HOOK_JOB_STARTED=${hooks.started}`)
  })
})
