/**
 * FILE: apps/admin/src/lib/retiredNavCopy.test.ts
 * PURPOSE: Report c0dc93ec. Copy that sends someone to a page must use the
 *          sidebar label in NAV_REGISTRY. "Recipe page" is "App blueprint".
 *          Comments are ignored; string literals in the console and in the
 *          server text it renders are not.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NAV_REGISTRY } from './navRegistry'

/** The name the October navigation pass removed. Not a nav label. */
const RETIRED_PAGE = 'Recipe page'

const repoRoot = resolve(__dirname, '../../../..')

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, '')
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) {
      walk(abs, out)
      continue
    }
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue
    out.push(abs)
  }
}

const SCANNED = [
  resolve(repoRoot, 'packages/server/supabase/functions/api/routes/portfolio.ts'),
  resolve(repoRoot, 'packages/server/supabase/functions/_shared/recipe-state.ts'),
]
walk(resolve(__dirname, '..'), SCANNED)

function hitsFor(needle: string): string[] {
  const hits: string[] = []
  for (const file of SCANNED) {
    const text = stripComments(readFileSync(file, 'utf8'))
    let from = 0
    for (;;) {
      const at = text.indexOf(needle, from)
      if (at === -1) break
      hits.push(`${file.slice(repoRoot.length + 1)}:${text.slice(0, at).split('\n').length}`)
      from = at + needle.length
    }
  }
  return hits
}

describe('retired page names stay out of console copy', () => {
  it('names /recipe App blueprint, which is a nav label', () => {
    const label = NAV_REGISTRY.find((e) => e.path === '/recipe')?.label
    expect(label).toBe('App blueprint')
    expect(NAV_REGISTRY.some((e) => e.label === 'Recipe' || e.label === RETIRED_PAGE)).toBe(false)
  })

  it('does not send anyone to the Recipe page', () => {
    const hits = hitsFor(RETIRED_PAGE)
    expect(hits, hits.join('\n')).toEqual([])
  })

  it('the Apps card compose error uses the nav label for /recipe', () => {
    const label = NAV_REGISTRY.find((e) => e.path === '/recipe')?.label
    const src = stripComments(readFileSync(SCANNED[0], 'utf8'))
    expect(src).toContain(`Open its ${label} page for detail.`)
  })
})
