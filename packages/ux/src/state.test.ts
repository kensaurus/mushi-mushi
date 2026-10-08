// SPDX-License-Identifier: MIT
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadState, newRunId, saveState, type RunState } from './state.js'

let dir = ''
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('run state', () => {
  it('round-trips and leaves no temp file behind', () => {
    dir = mkdtempSync(join(tmpdir(), 'mushi-ux-state-'))
    const state: RunState = {
      version: 1,
      runId: newRunId(new Date('2026-10-06T01:02:03Z')),
      baseUrl: 'http://localhost:5173',
      createdAt: '2026-10-06T01:02:03Z',
      updatedAt: '',
      agent: 'claude-code',
      model: null,
      worktree: null,
      branch: null,
      baseSha: null,
      surfaces: [],
    }
    expect(state.runId).toMatch(/^20261006-010203-[a-z0-9]{4}$/)
    saveState(dir, state)
    expect(readdirSync(dir)).toEqual(['state.json'])
    expect(loadState(dir)?.runId).toBe(state.runId)
  })

  it('returns null when no run exists and refuses unknown versions', () => {
    dir = mkdtempSync(join(tmpdir(), 'mushi-ux-state-'))
    expect(loadState(dir)).toBeNull()
    saveState(dir, { version: 2 } as unknown as RunState)
    expect(() => loadState(dir)).toThrow(/Unsupported run state version 2/)
  })
})
