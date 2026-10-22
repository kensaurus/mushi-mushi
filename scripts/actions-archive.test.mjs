// Host repos run Mushi's composite actions with
// `uses: kensaurus/mushi-mushi/.github/actions/<name>@ref`. The runner fetches
// that as GitHub's archive tarball, which drops every export-ignore path, so a
// broad `.github/ export-ignore` silently removed the actions ("Can't find
// 'action.yml'", glot.it, 2026-10-22). Every file under .github/actions must
// be in the archive; the rest of .github stays out.
//
// The archive is built from the working tree's .gitattributes and files with
// `git archive --worktree-attributes` over a temporary index, so the check
// sees uncommitted edits too.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function archivedGithubPaths() {
  const dir = mkdtempSync(join(tmpdir(), 'mushi-archive-'))
  const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') }
  try {
    execFileSync('git', ['add', '-A', '--', '.github', '.gitattributes'], { env })
    const tree = execFileSync('git', ['write-tree'], { env, encoding: 'utf8' }).trim()
    const tar = execFileSync('git', ['archive', '--worktree-attributes', '--format=tar', tree, '.github'], { maxBuffer: 64 * 1024 * 1024 })
    const list = execFileSync('tar', ['-t'], { input: tar, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    return list.split('\n').filter((p) => p && !p.endsWith('/'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const archived = archivedGithubPaths()

test('every composite action ships in the repo archive', () => {
  for (const f of ['.github/actions/fix-verify/action.yml', '.github/actions/fix-verify/verify.mjs', '.github/actions/sdk-lockfile-refresh/action.yml']) {
    assert.ok(archived.includes(f), `${f} missing from the archive`)
  }
})

test('nothing else from .github ships in the archive', () => {
  assert.deepEqual(archived.filter((p) => !p.startsWith('.github/actions/')), [])
})
