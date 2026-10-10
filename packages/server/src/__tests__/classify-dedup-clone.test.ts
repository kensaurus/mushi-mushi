/**
 * FILE: classify-dedup-clone.test.ts
 * PURPOSE: classify-report's dedup short-circuit cloned `title` / `area_tag`
 *          off a group-head row whose SELECT never fetched them, so every
 *          deduplicated report was written back with title = null and
 *          area_tag = null. Also pins that every JSON body the function
 *          returns says so in its Content-Type (the 400 / 404 / 500 paths
 *          used to default to text/plain).
 *
 *          index.ts imports Deno globals, so this is asserted at the source
 *          level (same pattern as feature-request-routing.test.ts).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SOURCE = readFileSync(
  resolve(__dirname, '../../supabase/functions/classify-report/index.ts'),
  'utf8',
)

/** The argument list of every `new Response(JSON.stringify(...), ...)` call. */
function jsonResponseCalls(src: string): string[] {
  const calls: string[] = []
  const re = /new Response\(\s*JSON\.stringify/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    let depth = 0
    let i = m.index + 'new Response'.length
    const start = i
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')' && --depth === 0) break
    }
    calls.push(src.slice(start, i + 1))
  }
  return calls
}

describe('classify-report dedup clone', () => {
  it('selects title and area_tag on the group head it clones from', () => {
    const select = SOURCE.match(/const \{ data: groupHead \} = await db\s*\.from\('reports'\)\s*\.select\('([^']+)'\)/)
    expect(select).not.toBeNull()
    const cols = select![1].split(',').map((c) => c.trim())
    expect(cols).toEqual(expect.arrayContaining(['title', 'area_tag']))
  })

  it('clones the selected columns instead of casting around a missing field', () => {
    expect(SOURCE).toMatch(/title: groupHead\.title \?\? null,/)
    expect(SOURCE).toMatch(/area_tag: groupHead\.area_tag \?\? null,/)
    expect(SOURCE).not.toMatch(/\(groupHead as Record<string, unknown>\)\.(title|area_tag)/)
  })
})

describe('classify-report JSON responses', () => {
  const calls = jsonResponseCalls(SOURCE)

  it('finds the responses (sanity check on the source parse)', () => {
    expect(calls.length).toBeGreaterThanOrEqual(8)
  })

  it('sets Content-Type: application/json on every JSON body', () => {
    const missing = calls.filter((c) => !c.includes("'Content-Type': 'application/json'"))
    expect(missing).toEqual([])
  })
})
