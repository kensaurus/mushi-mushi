// SPDX-License-Identifier: MIT
/**
 * The Cursor CLI transport for reviews (`--review cursor`, `--checker-via
 * cursor`): read-only ask mode, the model passed through, one retry, and the
 * failure said plainly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runs = vi.hoisted(() => ({ calls: [] as Array<{ cmd: string; args: string[] }>, results: [] as unknown[] }))

vi.mock('./proc.js', () => ({
  run: vi.fn(async (cmd: string, args: string[]) => {
    runs.calls.push({ cmd, args })
    return runs.results.shift() ?? { exitCode: 1, stdout: '', tail: 'no result queued', timedOut: false }
  }),
}))

import { askCursor, DEFAULT_CURSOR_REVIEW_MODEL } from './checker.js'

beforeEach(() => {
  runs.calls = []
  runs.results = []
})

describe('askCursor', () => {
  it('asks cursor-agent in read-only ask mode, with the model and the folder', async () => {
    runs.results.push({ exitCode: 0, stdout: '{"findings": []}', tail: '', timedOut: false })
    const a = await askCursor('Review desktop.png', '/tmp/shots', DEFAULT_CURSOR_REVIEW_MODEL)
    expect(a).toEqual({ text: '{"findings": []}', costUsd: null })
    const { cmd, args } = runs.calls[0]!
    expect(cmd).toBe('cursor-agent')
    expect(args).toEqual(expect.arrayContaining(['-p', '--mode', 'ask', '--workspace', '/tmp/shots', '--model', DEFAULT_CURSOR_REVIEW_MODEL, 'Review desktop.png']))
    expect(args).not.toContain('--force')
  })

  it('retries once, then says what failed', async () => {
    runs.results.push({ exitCode: 1, stdout: '', tail: 'not logged in', timedOut: false })
    runs.results.push({ exitCode: 1, stdout: '', tail: 'not logged in', timedOut: false })
    const a = await askCursor('q', '/tmp', 'grok-4.7-xhigh')
    expect(runs.calls).toHaveLength(2)
    expect(a.text).toBeNull()
    expect(a.error).toContain('Cursor CLI exited 1')
    expect(a.error).toContain('not logged in')
  }, 10_000)

  it('reports a timeout without retrying', async () => {
    runs.results.push({ exitCode: null, stdout: '', tail: '', timedOut: true })
    const a = await askCursor('q', '/tmp', 'grok-4.7-xhigh')
    expect(runs.calls).toHaveLength(1)
    expect(a.error).toContain('within 6 minutes')
  })
})
