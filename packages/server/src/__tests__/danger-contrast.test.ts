/**
 * `text-danger` must clear WCAG AA on the page surfaces it is painted on.
 *
 * Reads the dark @theme token and the light theme override (not a hardcoded
 * swatch) and measures with the same contrast function the design plane uses.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio, parseCssColor } from '../../supabase/functions/_shared/design-color.ts'

const adminStyles = resolve(__dirname, '../../../../apps/admin/src/styles')

function oklchDecl(css: string, name: string): string {
  const m = css.match(new RegExp(`(?:^|\\n)\\s*${name}:\\s*(oklch\\([^)]*\\))`))
  if (!m) throw new Error(`missing ${name}`)
  return m[1]
}

function color(css: string, name: string) {
  const parsed = parseCssColor(oklchDecl(css, name))
  if (!parsed) throw new Error(`unparsed ${name}`)
  return parsed
}

const DARK = readFileSync(resolve(adminStyles, 'theme-tokens.css'), 'utf8')
const LIGHT = readFileSync(resolve(adminStyles, 'base-and-density.css'), 'utf8')

describe('danger contrast', () => {
  it('keeps the dark red (hue 25), lightened so text clears AA', () => {
    expect(oklchDecl(DARK, '--color-danger')).toBe('oklch(0.72 0.22 25)')
  })

  it('clears 4.5:1 as dark text on surface, raised, and overlay', () => {
    const danger = color(DARK, '--color-danger')
    expect(contrastRatio(danger, color(DARK, '--color-surface'))).toBe(6.22)
    expect(contrastRatio(danger, color(DARK, '--color-surface-raised'))).toBe(5.75)
    expect(contrastRatio(danger, color(DARK, '--color-surface-overlay'))).toBe(5.18)
  })

  it('clears 4.5:1 for dark danger-fg on the solid fill', () => {
    expect(contrastRatio(color(DARK, '--color-danger-fg'), color(DARK, '--color-danger'))).toBe(6.41)
  })

  it('keeps the light red (hue 25), deepened so text clears AA', () => {
    expect(oklchDecl(LIGHT, '--color-danger')).toBe('oklch(0.48 0.24 25)')
  })

  it('clears 4.5:1 as light text on surface, raised, and overlay', () => {
    const danger = color(LIGHT, '--color-danger')
    expect(contrastRatio(danger, color(LIGHT, '--color-surface'))).toBe(5.79)
    expect(contrastRatio(danger, color(LIGHT, '--color-surface-raised'))).toBe(6.32)
    expect(contrastRatio(danger, color(LIGHT, '--color-surface-overlay'))).toBe(5.06)
  })

  it('clears 4.5:1 for light danger-fg on the solid fill', () => {
    expect(contrastRatio(color(LIGHT, '--color-danger-fg'), color(LIGHT, '--color-danger'))).toBe(6.07)
  })
})
