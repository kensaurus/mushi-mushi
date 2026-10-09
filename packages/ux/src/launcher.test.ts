// SPDX-License-Identifier: MIT
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { baseRefs } from './launcher.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mushi-ux-refs-'))
  dirs.push(dir)
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'a.txt'), 'a')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  writeFileSync(join(dir, 'a.txt'), 'b')
  git('commit', '-q', '-am', 'ux step')
  git('update-ref', 'refs/remotes/origin/mushi-ux/review-2026-10-06', 'HEAD')
  git('reset', '-q', '--hard', 'origin/main')
  return dir
}

// A new run could only start from main or HEAD, so it could not continue a review PR (2026-10-07).
describe('branches a run can start from', () => {
  it('offers earlier UX branches with how far ahead of main they are', async () => {
    const { refs } = await baseRefs(repo())
    const ux = refs.find((r) => r.ref === 'origin/mushi-ux/review-2026-10-06')
    expect(ux?.label).toBe('origin/mushi-ux/review-2026-10-06 (earlier UX work; 1 commit ahead of origin/main)')
    expect(refs.map((r) => r.ref)).toEqual(['origin/main', 'HEAD', 'origin/mushi-ux/review-2026-10-06'])
  })
})
