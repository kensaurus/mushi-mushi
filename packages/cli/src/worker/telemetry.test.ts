import { describe, expect, it } from 'vitest'
import { cleanLine, cursorCheckResult, ghCheckResult, maskEmail } from './telemetry.js'
import { hostGate } from './guards.js'
import { parseHeartbeatAnswer } from './protocol.js'

describe('a log line the worker sends to the console', () => {
  it('keeps no key, token, e-mail, path or quoted source, and is capped', () => {
    expect(cleanLine('git push failed: https://x-access-token:ghs_abcdefghijklmnopqrstuvwxyz0123@github.com/o/r.git')).toBe('git push failed: https://github.com/o/r.git')
    expect(cleanLine('MUSHI key mushi_abcdefghijklmnopqrstuvwxyz0123 refused')).toBe('[a line was hidden: it looked like a key or token]')
    expect(cleanLine('Authorization: Bearer abc.def')).toBe('Authorization: Bearer [hidden]')
    expect(cleanLine('token=abc123 expired')).toBe('token=[hidden] expired')
    expect(cleanLine('Logged in as suzu.haruka1130@gmail.com')).toBe('Logged in as s***@g***.com')
    expect(cleanLine('cd /home/mushi-agent/.cache/mushi/work/glot/abcd1234 && pnpm lint')).toBe('cd …/abcd1234 && pnpm lint')
    expect(cleanLine('C:\\Users\\kensa\\src\\glot\\file.ts failed')).toBe('…/file.ts failed')
    expect(cleanLine('  12 | const apiKey = load()')).toBeNull()
    expect(cleanLine('> 12 | x')).toBeNull()
    expect(cleanLine('src/app.ts(12,3): error TS2322: Type string is not assignable')).toBe('src/app.ts(12,3): error TS2322: Type string is not assignable')
    expect(cleanLine('a'.repeat(400))!.length).toBeLessThanOrEqual(160)
    expect(cleanLine('PR https://github.com/kensaurus/glot.it/pull/12 opened')).toBe('PR https://github.com/kensaurus/glot.it/pull/12 opened')
  })

  it('masks an account to its first letters', () => {
    expect(maskEmail('suzu@example.com')).toBe('s***@e***.com')
  })
})

describe('the account and gh checks as they really answered', () => {
  const out = 'Logged in as suzu.haruka1130@gmail.com'
  it('tells another account, signed out, timed out and missing apart', () => {
    expect(cursorCheckResult({ state: 'signed_in', detail: 'Logged in', output: out }, 'suzu.haruka1130@gmail.com')).toBe('expected')
    expect(cursorCheckResult({ state: 'signed_in', detail: 'Logged in', output: out }, 'other@x.io')).toBe('other_account')
    expect(cursorCheckResult({ state: 'signed_out', detail: 'Not logged in', output: '' }, undefined)).toBe('signed_out')
    expect(cursorCheckResult({ state: 'unknown', detail: 'timed out after 90 s', output: '' }, undefined)).toBe('timed_out')
    expect(cursorCheckResult({ state: 'unknown', detail: 'exit 3', output: '' }, undefined)).toBe('unclear')
    expect(cursorCheckResult({ state: 'missing', detail: '', output: '' }, undefined)).toBe('missing')
  })

  it('reads gh as signed out only on a clear answer', () => {
    expect(ghCheckResult({ code: 0, stderr: '' })).toBe('signed_in')
    expect(ghCheckResult({ code: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login' })).toBe('signed_out')
    expect(ghCheckResult({ code: null, timedOut: true, stderr: '' })).toBe('unknown')
    expect(ghCheckResult({ code: 1, stderr: 'connection reset' })).toBe('unknown')
  })

  it('the gate waits while gh is signed out (it used to stop the worker at start)', () => {
    const g = { max_agents: 4, min_free_mem_gb: 5, gh_floor: 800 }
    expect(hostGate(g, { memAvailableGb: 20, ghRemaining: null, cursor: 'signed_in', gh: 'signed_out', agents: 0 })).toMatchObject({ ok: false, state: 'auth-wait', why: expect.stringMatching(/gh auth login/) })
    expect(hostGate(g, { memAvailableGb: 20, ghRemaining: null, cursor: 'signed_in', gh: 'unknown', agents: 0 })).toEqual({ ok: true })
  })

  it('takes recheckAccount from the heartbeat answer only when it is true', () => {
    const base = { hostId: 'h', guards: { max_agents: 6, min_free_mem_gb: 5, gh_floor: 800 }, lanes: [], refused: [], renewed: [], lost: [] }
    const yes = parseHeartbeatAnswer({ ...base, recheckAccount: true })
    const odd = parseHeartbeatAnswer({ ...base, recheckAccount: 'yes' })
    expect('answer' in yes && yes.answer.recheckAccount).toBe(true)
    expect('answer' in odd && odd.answer.recheckAccount).toBe(false)
  })
})
