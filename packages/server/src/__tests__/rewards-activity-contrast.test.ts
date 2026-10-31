/**
 * The Rewards overview accepted count sits on surface-overlay. Its text
 * utility has to clear WCAG AA (4.5:1) there. Ratios come from the
 * design-plane function. Admin tests cannot import it (TS6059, rootDir).
 *
 * Threshold only. The utility is read from the component, so a different
 * token still has to clear 4.5:1 on that surface.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio, parseCssColor } from '../../supabase/functions/_shared/design-color.ts'

const adminStyles = resolve(__dirname, '../../../../apps/admin/src/styles')
const panels = readFileSync(
  resolve(__dirname, '../../../../apps/admin/src/components/rewards/tabs/panels.tsx'),
  'utf8',
)

function cssBlock(css: string, marker: string): string {
  const start = css.indexOf(marker)
  if (start < 0) throw new Error(`missing ${marker}`)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error(`unclosed ${marker}`)
}

function oklchDecl(block: string, name: string): string {
  const re = new RegExp(`(?:^|\\n)\\s*${name}:\\s*(oklch\\([^)]*\\))`, 'g')
  const found = [...block.matchAll(re)].map((m) => m[1])
  if (found.length !== 1) {
    throw new Error(`${name}: expected exactly one oklch declaration, found ${found.length}`)
  }
  return found[0]
}

function color(block: string, name: string) {
  const parsed = parseCssColor(oklchDecl(block, name))
  if (!parsed) throw new Error(`unparsed ${name}`)
  return parsed
}

/** The text utility on the accepted-count figure (`text-ok-foreground`, not `text-lg`). */
function acceptedTextToken(): string {
  const m = panels.match(/className="([^"]+)"[^>]*>\{feedData\.stats_24h\.accepted\}/)
  if (!m) throw new Error('accepted count figure not found')
  const colorClass = m[1]
    .split(/\s+/)
    .filter((c) => c.startsWith('text-') && c !== 'text-lg')
  if (colorClass.length !== 1) throw new Error(`expected one text color, found ${colorClass.join(' ')}`)
  const utility = colorClass[0]
  if (utility.includes('/') || utility.includes('[')) throw new Error(`unresolved utility ${utility}`)
  return `--color-${utility.slice('text-'.length)}`
}

const DARK = cssBlock(readFileSync(resolve(adminStyles, 'theme-tokens.css'), 'utf8'), '@theme {')
const LIGHT = cssBlock(readFileSync(resolve(adminStyles, 'base-and-density.css'), 'utf8'), 'html[data-theme="light"] {')

describe('rewards activity accepted count contrast', () => {
  const token = acceptedTextToken()

  it('clears 4.5:1 on surface-overlay in light and dark', () => {
    for (const block of [LIGHT, DARK]) {
      expect(contrastRatio(color(block, token), color(block, '--color-surface-overlay'))).toBeGreaterThanOrEqual(4.5)
    }
  })
})
