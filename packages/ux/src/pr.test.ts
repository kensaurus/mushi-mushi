// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import { continuedBranch, openRunPullRequest, prBody, prTitle } from './pr.js'
import type { IterationRecord, RunState, SurfaceState } from './state.js'

const kept = (sha: string, step: string, extra: Partial<IterationRecord> = {}): IterationRecord =>
  ({ n: 1, outcome: 'accepted', reason: 'Kept.', commitSha: sha, step, ...extra }) as IterationRecord

const screen = (label: string, path: string, iterations: IterationRecord[]): SurfaceState =>
  ({ surface: { key: path.replace(/\W/g, '') || 'home', label, path, kind: 'page' }, status: 'accepted', note: null, baseline: {}, iterations }) as unknown as SurfaceState

function run(surfaces: SurfaceState[], extra: Partial<RunState> = {}): RunState {
  return { runId: '20261007-115031-7po3', agent: 'cursor', model: 'grok-4.7-xhigh', branch: 'mushi-ux/20261007-115031-7po3', surfaces, ...extra } as RunState
}

describe('a finished run’s pull request', () => {
  it('continues the PR of the branch the run started from, never the default branch', () => {
    expect(continuedBranch('origin/mushi-ux/review-2026-10-06', 'main')).toBe('mushi-ux/review-2026-10-06')
    expect(continuedBranch('origin/main', 'main')).toBeNull()
    expect(continuedBranch('HEAD', 'main')).toBeNull()
    expect(continuedBranch(undefined, 'main')).toBeNull()
  })

  it('titles itself as a conventional commit that names the screens it changed', () => {
    const two = run([screen('Tone Training — glot.it', '/practice/tone-training', [kept('a1b2c3d4e5', 'x')]), screen('Review', '/review', [kept('b1', 'y')]), screen('Podcast', '/podcast', [])])
    expect(prTitle(two)).toBe('fix(ux): polish the Tone Training and Review screens')
    const five = run(['A', 'B', 'C', 'D'].map((l) => screen(l, `/${l}`, [kept('c1', 's')])))
    expect(prTitle(five)).toBe('fix(ux): polish the A, B and 2 more screens')
    expect(prTitle(five).length).toBeLessThanOrEqual(72)
  })

  it('lists kept steps, flags the ones to read, and says what the checker rolled back', () => {
    const body = prBody(
      run([
        screen('Review', '/review', [
          kept('abcdef123456', 'Keep the due count still while it loads', { checker: { model: 'claude-opus-5-5', verdict: 'keep' } as never }),
          kept('fedcba654321', 'Crossfade the card flip', { needsReview: true }),
          { n: 3, outcome: 'rejected', reason: 'r', commitSha: null, checker: { model: 'claude-opus-5-5', verdict: 'revert', summary: 'Both reviews preferred the original.' } } as unknown as IterationRecord,
        ]),
      ]),
    )
    expect(body).toContain('2 of 3 attempts kept.')
    expect(body).toContain('`abcdef123` Keep the due count still while it loads claude-opus-5-5: agrees.')
    expect(body).toContain('**Needs your review.**')
    expect(body).toContain('Rolled back by claude-opus-5-5: Both reviews preferred the original.')
    expect(body).toContain('`fedcba654` (Review)')
  })

  it('adds the run to an open PR with a plain push, and opens a draft PR otherwise', async () => {
    const calls: string[] = []
    const exec = (open: boolean) => async (cmd: string, args: readonly string[]) => {
      calls.push(`${cmd} ${args.join(' ')}`)
      if (args[0] === 'repo') return 'main\n'
      if (args[1] === 'list') return open ? '[{"number":146,"url":"https://github.com/kensaurus/glot.it/pull/146"}]' : '[]'
      if (args[1] === 'create') return 'https://github.com/kensaurus/glot.it/pull/150\n'
      return ''
    }
    const state = run([screen('Review', '/review', [kept('abc1234', 's')])], { baseRef: 'origin/mushi-ux/review-2026-10-06' })
    expect(await openRunPullRequest(state, exec(true))).toEqual({ url: 'https://github.com/kensaurus/glot.it/pull/146', number: 146, added: true })
    expect(calls).toContain('git push origin mushi-ux/20261007-115031-7po3:mushi-ux/review-2026-10-06')
    expect(calls.some((c) => c.includes('--force'))).toBe(false)

    calls.length = 0
    const pr = await openRunPullRequest({ ...state, baseRef: 'origin/main' }, exec(false))
    expect(pr).toEqual({ url: 'https://github.com/kensaurus/glot.it/pull/150', number: 150, added: false })
    expect(calls.find((c) => c.startsWith('gh pr create'))).toContain('--draft --base main --head mushi-ux/20261007-115031-7po3')
  })

  it('refuses a run that kept nothing', async () => {
    await expect(openRunPullRequest(run([screen('Review', '/review', [])]), async () => '')).rejects.toThrow('kept no change')
  })
})
