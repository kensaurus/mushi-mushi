import { describe, it, expect } from 'vitest'
import { matchesGlob } from './orchestrator-multi.js'

describe('matchesGlob (path_globs routing)', () => {
  it('a ** followed by a slash also matches zero directories, like the index path filter', () => {
    expect(matchesGlob('index.ts', '**/*.ts')).toBe(true)
    expect(matchesGlob('src/x/a.ts', '**/*.ts')).toBe(true)
    expect(matchesGlob('src/a.ts', 'src/**/*.ts')).toBe(true)
    expect(matchesGlob('src/x/y/a.ts', 'src/**/*.ts')).toBe(true)
    expect(matchesGlob('lib/a.ts', 'src/**/*.ts')).toBe(false)
  })

  it('keeps the other rules: ** spans directories, * stays in one segment', () => {
    expect(matchesGlob('src/a/b.ts', 'src/**')).toBe(true)
    expect(matchesGlob('apps/web/src/a.ts', 'apps/*/src/**')).toBe(true)
    expect(matchesGlob('apps/web/lib/a.ts', 'apps/*/src/**')).toBe(false)
    expect(matchesGlob('src/x/a.ts', 'src/*.ts')).toBe(false)
  })
})
