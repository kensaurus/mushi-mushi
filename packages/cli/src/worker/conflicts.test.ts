import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { conflictedPaths, conflictPromptLocal, markerLines, nulPaths, outsideChanges, parseLsFiles, repoOfRemote } from './conflicts.js'

describe('which repository a clone is', () => {
  it('reads owner/name from https and ssh remotes, lower case', () => {
    expect(repoOfRemote('https://github.com/Kensaurus/glot.it.git\n')).toBe('kensaurus/glot.it')
    expect(repoOfRemote('git@github.com:kensaurus/yen-yen.git')).toBe('kensaurus/yen-yen')
    expect(repoOfRemote('https://github.com/kensaurus/mushi-mushi')).toBe('kensaurus/mushi-mushi')
    expect(repoOfRemote('https://gitlab.com/x/y.git')).toBeNull()
    expect(repoOfRemote('/home/u/glot')).toBeNull()
  })
})

describe('conflict markers', () => {
  it('finds the three marker lines and nothing that only looks like them', () => {
    expect(markerLines('a\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> origin/main\nb')).toEqual([2, 4, 6])
    expect(markerLines('const s = "<<<<<<<"\n// ======= banner =======\n<<<<<<<<< nine')).toEqual([])
    expect(markerLines('ok\r\n=======\r\n')).toEqual([2])
  })
})

describe('what the agent may change', () => {
  const sha = (label: string) => createHash('sha1').update(label).digest('hex')
  const idx = (entries: Array<[string, number, string]>) => parseLsFiles(entries.map(([p, stage, blob]) => `100644 ${sha(blob)} ${stage}\t${p}`).join('\0'))

  it('allows the conflicted files only', () => {
    const before = idx([['a.ts', 1, 'a1'], ['a.ts', 2, 'a2'], ['a.ts', 3, 'a3'], ['b.ts', 0, 'b0']])
    expect(conflictedPaths(before)).toEqual(['a.ts'])
    const after = idx([['a.ts', 0, 'ar'], ['b.ts', 0, 'b0']])
    expect(outsideChanges({ before, after, conflicted: ['a.ts'], loosePaths: [] })).toEqual([])
  })

  it('refuses an edited, added or deleted file that had no conflict, staged or not', () => {
    const before = idx([['a.ts', 2, 'a2'], ['a.ts', 3, 'a3'], ['b.ts', 0, 'b0'], ['c.ts', 0, 'c0']])
    const after = idx([['a.ts', 0, 'ar'], ['b.ts', 0, 'bX'], ['n.ts', 0, 'n0']])
    expect(outsideChanges({ before, after, conflicted: ['a.ts'], loosePaths: ['d.ts'] })).toEqual(['b.ts', 'c.ts', 'd.ts', 'n.ts'])
  })

  it('reads NUL-separated paths', () => {
    expect(nulPaths('a.ts\0dir/b c.ts\0\n')).toEqual(['a.ts', 'dir/b c.ts'])
  })

  it('tells the agent the files, both intents, and no git commands', () => {
    const p = conflictPromptLocal({ repo: 'o/r', prNumber: 7, base: 'main', files: ['src/a.ts'] })
    expect(p).toContain('- src/a.ts')
    expect(p).toMatch(/Do not run git commit/)
    expect(p).toMatch(/refuses the whole result/)
  })
})

describe('the checks on a real merge', () => {
  let dir = ''
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' })

  function conflicted(): void {
    dir = mkdtempSync(join(tmpdir(), 'mushi-conflict-'))
    g('init', '-q', '-b', 'main')
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\n')
    writeFileSync(join(dir, 'b.txt'), 'keep\n')
    g('add', '-A')
    g('commit', '-q', '-m', 'base')
    g('checkout', '-q', '-b', 'pr')
    writeFileSync(join(dir, 'a.txt'), 'one\nTWO from the PR\nthree\n')
    g('commit', '-q', '-am', 'pr')
    g('checkout', '-q', 'main')
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo from main\nthree\n')
    // main also changes files the PR never touched: the merge brings them in.
    writeFileSync(join(dir, 'm.txt'), 'new on main\n')
    writeFileSync(join(dir, 'b.txt'), 'keep\nand more from main\n')
    g('add', '-A')
    g('commit', '-q', '-m', 'main')
    g('checkout', '-q', 'pr')
    try {
      g('merge', '--no-ff', '--no-commit', 'main')
    } catch {
      // A conflict exits 1: that is the state under test.
    }
  }
  const state = () => ({
    entries: parseLsFiles(g('ls-files', '-s', '-z')),
    loose: [...nulPaths(g('diff', '--name-only', '-z')), ...nulPaths(g('ls-files', '--others', '--exclude-standard', '-z'))],
  })

  it('a clean resolution of the conflicted file passes', () => {
    conflicted()
    const before = state().entries
    expect(conflictedPaths(before)).toEqual(['a.txt'])
    expect(markerLines(readFileSync(join(dir, 'a.txt'), 'utf8')).length).toBe(3)
    writeFileSync(join(dir, 'a.txt'), 'one\nTWO from the PR, two from main\nthree\n')
    g('add', '-A', '--', 'a.txt')
    const after = state()
    expect(conflictedPaths(after.entries)).toEqual([])
    // m.txt and b.txt came from main: never counted against the agent.
    expect(outsideChanges({ before, after: after.entries, conflicted: ['a.txt'], loosePaths: after.loose })).toEqual([])
  })

  it('an edit to a file without a conflict, or a new file, is caught', () => {
    conflicted()
    const before = state().entries
    writeFileSync(join(dir, 'a.txt'), 'one\nresolved\nthree\n')
    writeFileSync(join(dir, 'b.txt'), 'changed by the agent\n')
    writeFileSync(join(dir, 'm.txt'), 'and this one, staged\n')
    g('add', 'm.txt')
    writeFileSync(join(dir, 'c.txt'), 'new\n')
    g('add', '-A', '--', 'a.txt')
    const after = state()
    expect(outsideChanges({ before, after: after.entries, conflicted: ['a.txt'], loosePaths: after.loose })).toEqual(['b.txt', 'c.txt', 'm.txt'])
  })
})
