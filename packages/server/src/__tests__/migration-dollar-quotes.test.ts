/**
 * A bare `$$` inside a `DO $$ ... $$` block (a cron.schedule command, say)
 * closes the outer body early, so a fresh replay (self-host, Helm) stops with
 * a syntax error. 20260523030000 shipped that way; inner bodies need their
 * own tag, e.g. `$cron$`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = resolve(__dirname, '../../supabase/migrations')

/** `DO $$` blocks whose first following `$$` is not the end of the statement. */
function brokenDoBlocks(sql: string): number {
  const code = sql.replace(/--[^\n]*/g, '')
  let broken = 0
  for (const m of code.matchAll(/\bDO\s+\$\$/gi)) {
    const close = code.indexOf('$$', m.index! + m[0].length)
    if (close < 0 || !/^\s*(;|language\b)/i.test(code.slice(close + 2))) broken++
  }
  return broken
}

describe('migration dollar quotes', () => {
  it('flags a bare $$ nested in DO $$', () => {
    expect(brokenDoBlocks("DO $$ BEGIN PERFORM cron.schedule('x', '* * * * *', $$ SELECT 1; $$); END; $$;")).toBe(1)
    expect(brokenDoBlocks("DO $$ BEGIN PERFORM cron.schedule('x', '* * * * *', $cron$ SELECT 1; $cron$); END; $$;")).toBe(0)
  })

  it('no migration nests a bare $$ inside DO $$', () => {
    const bad = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .filter((f) => brokenDoBlocks(readFileSync(resolve(dir, f), 'utf8')) > 0)
    expect(bad).toEqual([])
  })
})
