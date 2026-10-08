// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { expectedHead, isRunAlive, resumeSettings, saveSkillFiles } from './resume.js'
import { runDir, saveState, type RunState } from './state.js'

const RUN = '20261006-093719-2ohc'
const NOW = Date.parse('2026-10-06T10:30:00Z')
let root = ''
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = ''
})

function state(over: Partial<RunState> = {}): RunState {
  return {
    version: 1,
    runId: RUN,
    baseUrl: '',
    createdAt: '2026-10-06T09:37:19Z',
    updatedAt: '2026-10-06T10:07:38Z',
    agent: 'cursor',
    model: 'grok-4.7-xhigh',
    phase: 'working',
    worktree: 'wt',
    branch: 'mushi-ux/x',
    baseSha: 'base000',
    surfaces: [],
    options: { agent: 'cursor', model: 'grok-4.7-xhigh', devCommand: 'npx next dev -p {port}', iterations: 2, maxSurfaces: 5, agentTimeoutMs: 900_000, sync: true },
    ...over,
  }
}

/** Saves the state; saveState stamps updatedAt with the real clock, as a live run would. */
function write(s: RunState) {
  root = root || mkdtempSync(join(tmpdir(), 'mushi-ux-resume-'))
  saveState(runDir(root, RUN), s)
}

describe('resumeSettings', () => {
  it('returns the saved settings and skill of a run that stopped', () => {
    const s = state({ skill: { name: 'enhance-mobile-native-feel', source: 'kensaurus/skills' } })
    write(s)
    // Judged five minutes after its last save: it is no longer running anywhere.
    const later = Date.now() + 5 * 60_000
    saveSkillFiles(runDir(root, RUN), { name: 'enhance-mobile-native-feel', source: 'kensaurus/skills', text: '# Skill', files: { 'SKILL.md': Buffer.from('# Skill'), 'references/a.md': Buffer.from('ref') } })
    const got = resumeSettings(root, RUN, later)
    expect(got.options.devCommand).toBe('npx next dev -p {port}')
    expect(got.skill?.text).toBe('# Skill')
    expect(Object.keys(got.skill?.files ?? {}).sort()).toEqual(['SKILL.md', 'references/a.md'])
  })

  it('says why a run cannot be resumed', () => {
    root = mkdtempSync(join(tmpdir(), 'mushi-ux-resume-'))
    expect(() => resumeSettings(root, RUN)).toThrow(/No run/)
    write(state())
    expect(() => resumeSettings(root, RUN, Date.now())).toThrow(/still running somewhere/)
    write(state({ phase: 'done' }))
    expect(() => resumeSettings(root, RUN)).toThrow(/already finished/)
    write(state({ options: undefined, phase: 'failed' }))
    expect(() => resumeSettings(root, RUN)).toThrow(/mushi-ux run --resume 20261006-093719-2ohc --dev/)
    write(state({ phase: 'failed', skill: { name: 'gone', source: 'x' } }))
    expect(() => resumeSettings(root, RUN)).toThrow(/saved copy is missing/)
  })
})

describe('isRunAlive', () => {
  it('is alive only while unfinished and saved in the last 90 s', () => {
    expect(isRunAlive(state({ updatedAt: '2026-10-06T10:29:20Z' }), NOW)).toBe(true)
    expect(isRunAlive(state({ updatedAt: '2026-10-06T10:20:00Z' }), NOW)).toBe(false)
    expect(isRunAlive(state({ updatedAt: '2026-10-06T10:29:50Z', phase: 'failed' }), NOW)).toBe(false)
  })
})

describe('expectedHead', () => {
  const it0 = (n: number, outcome: 'accepted' | 'rejected', commitSha: string | null, startedAt: string) => ({
    n, agent: 'a', model: null, startedAt, durationMs: 1, outcome, reason: '', commitSha, pixelDiff: {}, after: {}, diffPng: {}, logTail: '',
  })
  const surface = (key: string, iterations: ReturnType<typeof it0>[]) => ({
    surface: { key, kind: 'page' as const, path: '/', steps: [], label: key, domHash: '' }, status: 'accepted' as const, note: null, baseline: {}, iterations,
  })

  it('is the last kept commit by time, or the base when nothing was kept', () => {
    expect(expectedHead(state())).toBe('base000')
    const s = state({
      surfaces: [
        surface('b', [it0(1, 'accepted', 'bbb', '2026-10-06T10:05:00Z')]),
        surface('a', [it0(1, 'accepted', 'aaa', '2026-10-06T09:50:00Z'), it0(2, 'rejected', null, '2026-10-06T10:10:00Z')]),
      ],
    })
    expect(expectedHead(s)).toBe('bbb')
  })
})
