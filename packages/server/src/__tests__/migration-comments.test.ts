/**
 * Postgres nests block comments, so a header that mentions `@mushi-mushi/*`
 * opens a second comment that never closes. 20261003193000 failed on prod
 * with "unterminated /* comment" although every repo check passed.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Block-comment depth left open at end of file, skipping strings, line comments and $tag$ bodies. */
function openCommentDepth(sql: string): number {
  let depth = 0
  let i = 0
  let inString = false
  let inLine = false
  let dollar: string | null = null
  while (i < sql.length) {
    const c = sql[i]
    const n = sql[i + 1]
    if (inLine) { if (c === '\n') inLine = false; i++; continue }
    if (dollar) { if (sql.startsWith(dollar, i)) { i += dollar.length; dollar = null } else i++; continue }
    if (depth > 0) {
      if (c === '/' && n === '*') { depth++; i += 2; continue }
      if (c === '*' && n === '/') { depth--; i += 2; continue }
      i++
      continue
    }
    if (inString) { if (c === "'") inString = false; i++; continue }
    if (c === '-' && n === '-') { inLine = true; i += 2; continue }
    if (c === '/' && n === '*') { depth = 1; i += 2; continue }
    if (c === "'") { inString = true; i++; continue }
    if (c === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))?.[0]
      if (tag) { dollar = tag; i += tag.length; continue }
    }
    i++
  }
  return depth
}

const DIRS = ['../../supabase/migrations', '../../../../deploy/helm/migrations']

describe('migration block comments', () => {
  it('counts a nested opener the way Postgres does', () => {
    expect(openCommentDepth('/* bump @mushi-mushi/* packages */ select 1;')).toBe(1)
    expect(openCommentDepth('/* bump @mushi-mushi packages */ select 1;')).toBe(0)
    expect(openCommentDepth("select '/*' as s; -- /* not a comment\nselect $f$ /* $f$;")).toBe(0)
  })

  for (const rel of DIRS) {
    it(`every file in ${rel.split('/').slice(-2).join('/')} closes its comments`, () => {
      const dir = resolve(__dirname, rel)
      const open = readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .filter((f) => openCommentDepth(readFileSync(resolve(dir, f), 'utf8')) !== 0)
      expect(open).toEqual([])
    })
  }
})
