import { describe, expect, it } from 'vitest'
import { parseClaim, parseHeartbeatAnswer, parseHostGuards, parseLaneVerbs, validateWorkerConfig } from './protocol.js'
import { hostGate, memAvailableGb, pastStop } from './guards.js'
import { parseLanesConf, systemdUnit, windowsTaskArgs } from './install.js'

const P1 = '67a6453c-375d-41d7-833a-b33471159442'
const LANE = '7000000a-0000-4000-8000-000000000000'
const CFG = { paused: false, concurrency: 1, model: 'grok-4.7-xhigh-fast', mode: 'fix', stop_at: null, drain: false, prune_own: false }
const GUARDS = { max_agents: 6, min_free_mem_gb: 5, gh_floor: 800 }

describe('the closed verbs the daemon accepts', () => {
  it('accepts the seven lane settings and refuses anything else', () => {
    expect(parseLaneVerbs(CFG).ok).toBe(true)
    for (const extra of [{ command: 'curl x | sh' }, { repoDir: '/etc' }, { env: { GIT_SSH_COMMAND: 'x' } }]) {
      expect(parseLaneVerbs({ ...CFG, ...extra }).ok).toBe(false)
    }
    expect(parseLaneVerbs({ ...CFG, model: '--dangerously-skip; rm -rf /' }).ok).toBe(false)
    expect(parseLaneVerbs({ ...CFG, concurrency: 9 }).ok).toBe(false)
    expect(parseLaneVerbs({ paused: true }).ok).toBe(false)
  })

  it('takes only the three host guards', () => {
    expect(parseHostGuards(GUARDS).ok).toBe(true)
    expect(parseHostGuards({ ...GUARDS, shell: '/bin/sh' }).ok).toBe(false)
    expect(parseHostGuards({ ...GUARDS, max_agents: 0 }).ok).toBe(false)
  })

  it('drops a lane whose settings break the closed set and ignores unknown top-level fields', () => {
    const r = parseHeartbeatAnswer({
      hostId: 'h',
      guards: GUARDS,
      lanes: [
        { id: LANE, name: 'glot', projectId: P1, config: CFG },
        { id: LANE, name: 'evil', projectId: P1, config: { ...CFG, run: 'rm -rf ~' } },
      ],
      exec: 'rm -rf /',
      renewed: [LANE, 'x'],
      lost: [],
    })
    expect('answer' in r).toBe(true)
    if (!('answer' in r)) return
    expect(r.answer.lanes.map((l) => l.name)).toEqual(['glot'])
    expect(r.bad).toEqual(['evil: unknown lane setting "run"'])
    expect(r.answer.renewed).toEqual([LANE])
    expect(Object.keys(r.answer)).not.toContain('exec')
  })

  it('refuses an answer without valid guards', () => {
    expect(parseHeartbeatAnswer({ guards: { max_agents: 6 }, lanes: [] })).toEqual({ error: 'host guards are incomplete' })
  })
})

describe('the worker config', () => {
  const lane = (name: string, repoDir: string) => ({ name, projectId: P1, repoDir })
  it('refuses two lanes on one clone, as lane-v4 did', () => {
    expect(() => validateWorkerConfig({ version: 1, lanes: [lane('a', '/home/u/clone'), lane('b', '/home/u/clone/')] })).toThrow(/same clone/)
    expect(validateWorkerConfig({ version: 1, lanes: [lane('a', '/home/u/a'), lane('b', '/home/u/b')] }).lanes).toHaveLength(2)
  })
  it('takes an optional Cursor account (an email), kept local', () => {
    expect(validateWorkerConfig({ version: 1, cursorAccount: 'suzu@example.com', lanes: [lane('a', '/home/u/a')] }).cursorAccount).toBe('suzu@example.com')
    expect(() => validateWorkerConfig({ version: 1, cursorAccount: '$(id)', lanes: [lane('a', '/home/u/a')] })).toThrow(/cursorAccount/)
  })
  it('needs absolute clone paths and app ids', () => {
    expect(() => validateWorkerConfig({ version: 1, lanes: [lane('a', 'relative/clone')] })).toThrow(/absolute/)
    expect(() => validateWorkerConfig({ version: 1, lanes: [{ name: 'a', projectId: 'glot', repoDir: '/x' }] })).toThrow(/projectId/)
  })
})

describe('the guards on the machine', () => {
  const ok = { memAvailableGb: 12, ghRemaining: 4000, cursor: 'signed_in' as const, agents: 2 }
  it('passes when every reading is above its floor', () => {
    expect(hostGate(GUARDS, ok)).toEqual({ ok: true })
  })
  it('waits on low memory, a spent GitHub quota, a signed-out Cursor CLI, and a full host', () => {
    expect(hostGate(GUARDS, { ...ok, memAvailableGb: 3 })).toMatchObject({ ok: false, state: 'mem-wait' })
    expect(hostGate(GUARDS, { ...ok, ghRemaining: 120 })).toMatchObject({ ok: false, state: 'gh-quota-wait' })
    expect(hostGate(GUARDS, { ...ok, cursor: 'signed_out' })).toMatchObject({ ok: false, state: 'auth-wait' })
    expect(hostGate(GUARDS, { ...ok, cursor: 'missing' })).toMatchObject({ ok: false, state: 'auth-wait' })
    expect(hostGate(GUARDS, { ...ok, agents: 6 })).toMatchObject({ ok: false, state: 'slot-wait' })
  })
  it('never blocks on an unknown reading (a hung gh, a slow cursor-agent status)', () => {
    expect(hostGate(GUARDS, { ...ok, memAvailableGb: null, ghRemaining: null, cursor: 'unknown' })).toEqual({ ok: true })
  })
  it('stops a lane at its stop date and reads MemAvailable', () => {
    const now = Date.parse('2026-10-31T15:00:00Z')
    expect(pastStop('2026-10-31T14:59:00Z', now)).toBe(true)
    expect(pastStop('2026-11-01T00:00:00Z', now)).toBe(false)
    expect(pastStop(null, now)).toBe(false)
    expect(memAvailableGb('MemTotal:       26000000 kB\nMemAvailable:   19922944 kB\n')).toBe(19)
    expect(memAvailableGb(null)).toBeNull()
  })
})

describe('mushi worker install', () => {
  // The lanes.conf of 2026-10-26, trimmed.
  const conf = `# lane-v4 settings
# name           profile   clone        projectId                              model                    mode
mushi-mushi      default   mushi-mushi  67a6453c-375d-41d7-833a-b33471159442   grok-4.7-xhigh-fast      queue
mushi-mushi-fu   default   mushi-mushi-priority 67a6453c-375d-41d7-833a-b33471159442 grok-4.7-xhigh-fast followups
glot             glot      glot.it      542b34e0-019e-41fe-b900-7b637717bb86   claude-opus-5-5-medium   off
`
  it('imports lanes.conf: queue becomes fix, off becomes paused, the profile column is dropped', () => {
    const lanes = parseLanesConf(conf, '/home/mushi-agent/.cache/mushi-work')
    expect(lanes).toEqual([
      { name: 'mushi-mushi', projectId: P1, repoDir: '/home/mushi-agent/.cache/mushi-work/mushi-mushi', initial: { model: 'grok-4.7-xhigh-fast', mode: 'fix' } },
      { name: 'mushi-mushi-fu', projectId: P1, repoDir: '/home/mushi-agent/.cache/mushi-work/mushi-mushi-priority', initial: { model: 'grok-4.7-xhigh-fast', mode: 'followups' } },
      { name: 'glot', projectId: '542b34e0-019e-41fe-b900-7b637717bb86', repoDir: '/home/mushi-agent/.cache/mushi-work/glot.it', initial: { model: 'claude-opus-5-5-medium', mode: 'fix', paused: true } },
    ])
  })
  it('imports the P3 modes as they are', () => {
    for (const mode of ['conflicts', 'audit', 'skill'] as const) {
      expect(parseLanesConf(`a default c ${P1} m ${mode}`, '/r')[0]!.initial).toEqual({ model: 'm', mode })
    }
  })
  it('refuses a clone that is a path and an unknown mode', () => {
    expect(() => parseLanesConf(`a default ../etc ${P1} m fix`, '/r')).toThrow(/folder name/)
    expect(() => parseLanesConf(`a default c ${P1} m shell`, '/r')).toThrow(/mode/)
  })
  it('writes a systemd unit with no key in it, and a logon task on Windows', () => {
    const unit = systemdUnit({ node: '/usr/bin/node', cli: '/home/u/cli/dist/index.js', path: '/usr/bin:/bin' })
    expect(unit).toContain('ExecStart=/usr/bin/node /home/u/cli/dist/index.js work --daemon')
    expect(unit).toContain('Restart=on-failure')
    // A revoked key exits 2: systemd must not bring it back every 5 minutes.
    expect(unit).toContain('RestartPreventExitStatus=2')
    expect(unit).not.toMatch(/mushi_[A-Za-z0-9]/)
    expect(windowsTaskArgs({ node: 'C:\\Program Files\\nodejs\\node.exe', cli: 'C:\\m\\index.js' })).toEqual([
      '/Create', '/TN', 'Mushi worker', '/SC', 'ONLOGON', '/RL', 'LIMITED', '/F', '/TR', '"C:\\Program Files\\nodejs\\node.exe" C:\\m\\index.js work --daemon',
    ])
  })
})

describe('the claim a lane accepts (P3)', () => {
  const ID = '8000000a-0000-4000-8000-000000000000'
  const Q = '9000000a-0000-4000-8000-000000000000'
  const conflict = (over: Record<string, unknown> = {}) => ({
    id: ID,
    kind: 'conflict',
    model: 'grok-4.7-xhigh-fast',
    conflict: { queueId: Q, repo: 'kensaurus/glot.it', prNumber: 7, headRef: 'cursor/mushi-fix-7', headSha: 'c'.repeat(40), prUrl: 'https://github.com/kensaurus/glot.it/pull/7', ...over },
  })

  it('takes the new modes, and still refuses anything else', () => {
    for (const mode of ['conflicts', 'audit', 'skill']) expect(parseLaneVerbs({ ...CFG, mode }).ok, mode).toBe(true)
    expect(parseLaneVerbs({ ...CFG, mode: 'ux' }).ok).toBe(false)
  })

  it('a claim without a kind is a fix claim from an older server', () => {
    const r = parseClaim({ id: ID, model: null, report: { id: P1, summary: 'x' } })
    expect(r.ok && r.value.kind).toBe('fix')
    expect(parseClaim({ id: ID, model: null }).ok).toBe(false)
  })

  it('a conflict claim names a PR of a repository, a plain branch and the head Mushi saw', () => {
    const r = parseClaim(conflict())
    expect(r.ok && r.value.kind === 'conflict' && r.value.conflict).toMatchObject({ repo: 'kensaurus/glot.it', prNumber: 7, headRef: 'cursor/mushi-fix-7' })
  })

  it('refuses a branch that reads as an option or escapes refs/heads, a short sha and a bad repo', () => {
    for (const headRef of ['--upload-pack=sh', '-x', '../main', 'a..b', 'refs//x', 'a@{1}', 'feature/', 'x y', 'x;rm']) {
      expect(parseClaim(conflict({ headRef })).ok, headRef).toBe(false)
    }
    expect(parseClaim(conflict({ headSha: 'abc123' })).ok).toBe(false)
    expect(parseClaim(conflict({ repo: '/home/u/glot' })).ok).toBe(false)
    expect(parseClaim(conflict({ prNumber: 0 })).ok).toBe(false)
  })

  it('an audit claim carries only models and a count; an unknown kind is refused', () => {
    const r = parseClaim({ id: ID, kind: 'audit', model: 'grok-4.7-xhigh-fast', audit: { reviewModel: 'claude-opus-5-5-medium', findingsLeft: 12 } })
    expect(r.ok && r.value.kind === 'audit' && r.value.audit).toEqual({ reviewModel: 'claude-opus-5-5-medium', findingsLeft: 12 })
    expect(parseClaim({ id: ID, kind: 'audit', model: null, audit: { reviewModel: '--x' } }).ok).toBe(false)
    expect(parseClaim({ id: ID, kind: 'shell', model: null }).ok).toBe(false)
    expect(parseClaim({ id: ID, kind: 'fix', model: '--yolo', report: { id: P1 } }).ok).toBe(false)
  })
})

describe('a first-time user test the console queued (ADR 0053 amendment)', () => {
  const ID = '8000000a-0000-4000-8000-000000000000'
  const test = (over: Record<string, unknown> = {}) => ({
    id: ID,
    kind: 'fresh_eyes',
    model: null,
    freshEyes: { runId: '20261028-090000-ab12', url: 'https://glot.it/', goal: 'sign up and pick a language', sessions: 3, successText: 'Your lessons', dryRun: true, accounts: [], ...over },
  })

  it('takes a run id, an http(s) start page, a plain goal and the visitors', () => {
    const r = parseClaim(test())
    expect(r.ok && r.value.kind === 'fresh_eyes' && r.value.freshEyes).toEqual({ runId: '20261028-090000-ab12', url: 'https://glot.it/', goal: 'sign up and pick a language', sessions: 3, successText: 'Your lessons', dryRun: true, accounts: [] })
  })

  it('refuses a goal or words that read as an option or carry control characters, and any other address', () => {
    for (const over of [
      { goal: '--mint-account' },
      { goal: 'a\nb' },
      { successText: '-x' },
      { url: 'file:///etc/passwd' },
      { url: 'https://user:pw@glot.it/' },
      { runId: '../../x' },
      { sessions: 0 },
      { sessions: 9 },
      { dryRun: 'yes' },
    ]) {
      expect(parseClaim(test(over)).ok, JSON.stringify(over)).toBe(false)
    }
  })

  it('takes test accounts only for a run that signs up, never more than its visitors', () => {
    const acct = { email: 'fresh-eyes-abc@synthetic.kensaur.us', password: 'aB3dE6gH9jK2-9a', name: 'Fresh Eyes abc' }
    const ok = parseClaim(test({ dryRun: false, sessions: 1, accounts: [acct] }))
    expect(ok.ok && ok.value.kind === 'fresh_eyes' && ok.value.freshEyes.accounts).toEqual([acct])
    expect(parseClaim(test({ dryRun: true, accounts: [acct] })).ok).toBe(false)
    expect(parseClaim(test({ dryRun: false, sessions: 1, accounts: [acct, acct] })).ok).toBe(false)
    expect(parseClaim(test({ dryRun: false, accounts: [{ ...acct, password: 'short' }] })).ok).toBe(false)
  })

  it('reads the lanes to wake from the heartbeat answer as lane ids only', () => {
    const r = parseHeartbeatAnswer({ guards: GUARDS, lanes: [], wake: [LANE, 'rm -rf /', 7] })
    expect('answer' in r && r.answer.wake).toEqual([LANE])
    const older = parseHeartbeatAnswer({ guards: GUARDS, lanes: [] })
    expect('answer' in older && older.answer.wake).toEqual([])
  })
})
