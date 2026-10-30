/**
 * A run killed inside `git worktree add` leaves git's record of the worktree
 * locked as "initializing" with no folder. `clearWorktree` used to return
 * early when the folder was missing, so every later run of that report failed
 * with "already used by worktree" (the yen-yen lane looped on it, 2026-10-30).
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clearWorktree } from './work.js'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

let dir = ''
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('clearWorktree', () => {
  it('clears a locked record whose folder is gone, so the branch can be checked out again', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mushi-wt-'))
    const repo = join(dir, 'repo')
    const wt = join(dir, 'wt')
    execFileSync('git', ['init', '-q', '-b', 'main', repo])
    git(repo, 'config', 'user.email', 't@example.com')
    git(repo, 'config', 'user.name', 'T')
    writeFileSync(join(repo, 'a.txt'), 'a')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'init')
    git(repo, 'worktree', 'add', '-q', '-B', 'fix/x', wt, 'main')
    git(repo, 'worktree', 'lock', '--reason', 'initializing', wt)
    rmSync(wt, { recursive: true, force: true })

    expect(() => git(repo, 'worktree', 'add', '-q', '-B', 'fix/x', wt, 'main')).toThrow()
    await clearWorktree(repo, wt)
    git(repo, 'worktree', 'add', '-q', '-B', 'fix/x', wt, 'main')
    expect(existsSync(join(wt, 'a.txt'))).toBe(true)
  })
})
