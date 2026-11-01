/**
 * FILE: toggle-thumb.test.ts
 * PURPOSE: Keep the switch thumb light in every theme.
 *
 *          The thumb used `bg-fg`, which is near-white in dark mode and
 *          near-black (oklch 0.22) in light mode — so every enabled switch in
 *          the light console rendered as a black knob on a vermillion track
 *          (2026-09-23 owner report). The thumb now has its own token.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FORMS = readFileSync(join(__dirname, 'forms.tsx'), 'utf8')
const STYLES = join(__dirname, '../../styles')
const THEME = readFileSync(join(STYLES, 'theme-tokens.css'), 'utf8')
const MODES = readFileSync(join(STYLES, 'base-and-density.css'), 'utf8')

/** Toggle's code with comments stripped (they may name the retired class). */
function toggleSource(): string {
  const start = FORMS.indexOf('export function Toggle(')
  const end = FORMS.indexOf('/* ── Textarea', start)
  return FORMS.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function lightness(decl: string): number {
  const m = decl.match(/oklch\(\s*([\d.]+)/)
  if (!m) throw new Error(`not an oklch literal: ${decl}`)
  return Number(m[1])
}

describe('Toggle thumb', () => {
  it('uses the dedicated thumb token, never the theme foreground', () => {
    const src = toggleSource()
    expect(src).toContain('bg-switch-thumb')
    // Whole class token only (`hover:bg-fg-faint` on the track is fine).
    expect(src).not.toMatch(/(^|[\s'"`])bg-fg(?=[\s'"`])/)
  })

  it('defines a light thumb in the base theme', () => {
    const decl = THEME.match(/--color-switch-thumb:\s*([^;]+);/)?.[1]
    expect(decl).toBeDefined()
    expect(lightness(decl!)).toBeGreaterThanOrEqual(0.9)
  })

  it('is not flipped dark by any theme override', () => {
    for (const m of MODES.matchAll(/--color-switch-thumb:\s*([^;]+);/g)) {
      expect(lightness(m[1])).toBeGreaterThanOrEqual(0.9)
    }
  })

  it('gives the off track a visible fill instead of the card surface', () => {
    const src = toggleSource()
    expect(src).not.toMatch(/'bg-surface-raised[^']*'\s*}`/)
    expect(src).toContain("'bg-edge")
  })
})
