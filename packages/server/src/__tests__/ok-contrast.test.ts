/**
 * FILE: ok-contrast.test.ts
 * PURPOSE: Light-mode `text-ok` must clear WCAG AA on the surfaces it is
 *          painted on, and the token must stay inside sRGB so the painted
 *          green matches the measured one.
 *
 * OVERVIEW:
 * - Reads the light theme block and the dark @theme block from admin CSS.
 * - Measures contrast with the design-plane function (design-color.ts).
 * - Checks linear-sRGB gamut with no channel clamp.
 *
 * DEPENDENCIES:
 * - apps/admin/src/styles/base-and-density.css (light --color-ok)
 * - apps/admin/src/styles/theme-tokens.css (dark --color-ok)
 * - packages/server/supabase/functions/_shared/design-color.ts
 *
 * USAGE:
 * - Server vitest suite. Admin tests cannot import design-color.ts
 *   (apps/admin tsconfig rootDir). The light ok comment names this file.
 *
 * NOTES:
 * - Report 2b076ca8: the rewards accepted count (.text-lg.text-ok.tabular-nums
 *   on bg-surface-overlay) was 4.39:1 after channel clamp. Dark ok already
 *   clears 4.5:1; this file only locks that, and does not require it in gamut.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio, parseCssColor } from '../../supabase/functions/_shared/design-color.ts'

const adminStyles = resolve(__dirname, '../../../../apps/admin/src/styles')

/** Interior of the first `marker` rule. `marker` includes the opening brace. */
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
    throw new Error(`${name}: expected exactly one oklch declaration in the theme block, found ${found.length}`)
  }
  return found[0]
}

function color(block: string, name: string) {
  const parsed = parseCssColor(oklchDecl(block, name))
  if (!parsed) throw new Error(`unparsed ${name}`)
  return parsed
}

function parseOklch(decl: string): { L: number; C: number; H: number } {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(decl)
  if (!m) throw new Error(`not oklch: ${decl}`)
  return { L: Number(m[1]), C: Number(m[2]), H: Number(m[3]) }
}

/** OKLCH → linear-light sRGB, unclamped. A channel outside [0, 1] is outside sRGB. */
function linearSrgbChannels(decl: string): [number, number, number] {
  const { L, C, H } = parseOklch(decl)
  const rad = (H * Math.PI) / 180
  const A = C * Math.cos(rad)
  const B = C * Math.sin(rad)
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B
  const s_ = L - 0.0894841775 * A - 1.291485548 * B
  const l = l_ ** 3
  const mm = m_ ** 3
  const s = s_ ** 3
  return [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ]
}

function expectInsideSrgb(decl: string) {
  const [r, g, b] = linearSrgbChannels(decl)
  expect(r).toBeGreaterThanOrEqual(0)
  expect(r).toBeLessThanOrEqual(1)
  expect(g).toBeGreaterThanOrEqual(0)
  expect(g).toBeLessThanOrEqual(1)
  expect(b).toBeGreaterThanOrEqual(0)
  expect(b).toBeLessThanOrEqual(1)
}

const LIGHT = cssBlock(readFileSync(resolve(adminStyles, 'base-and-density.css'), 'utf8'), 'html[data-theme="light"] {')
const DARK = cssBlock(readFileSync(resolve(adminStyles, 'theme-tokens.css'), 'utf8'), '@theme {')

describe('ok contrast', () => {
  const ok = color(LIGHT, '--color-ok')
  const surface = color(LIGHT, '--color-surface')
  const raised = color(LIGHT, '--color-surface-raised')
  const overlay = color(LIGHT, '--color-surface-overlay')

  it('keeps one in-gamut light green (hue 155), chroma pulled in so text clears AA', () => {
    const decl = oklchDecl(LIGHT, '--color-ok')
    expect(decl).toBe('oklch(0.48 0.11 155)')
    expect(parseOklch(decl).H).toBe(155)
    expectInsideSrgb(decl)
  })

  it('clears 4.5:1 as light text on surface, raised, and overlay', () => {
    expect(contrastRatio(ok, surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(ok, raised)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(ok, overlay)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(ok, surface)).toBe(5.59)
    expect(contrastRatio(ok, raised)).toBe(6.1)
    expect(contrastRatio(ok, overlay)).toBe(4.88)
  })

  it('clears 4.5:1 for light ok-fg on the solid fill', () => {
    expect(contrastRatio(color(LIGHT, '--color-ok-fg'), ok)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(color(LIGHT, '--color-ok-fg'), ok)).toBe(6.02)
  })

  it('clears 4.5:1 for light ok text on ok-muted', () => {
    expect(contrastRatio(ok, color(LIGHT, '--color-ok-muted'))).toBeGreaterThanOrEqual(4.5)
  })

  it('still clears 4.5:1 as dark text on surface, raised, and overlay', () => {
    const dark = color(DARK, '--color-ok')
    expect(contrastRatio(dark, color(DARK, '--color-surface'))).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(dark, color(DARK, '--color-surface-raised'))).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(dark, color(DARK, '--color-surface-overlay'))).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(color(DARK, '--color-ok-fg'), dark)).toBeGreaterThanOrEqual(4.5)
  })

  it('is named from the light ok token comment', () => {
    expect(LIGHT).toContain('ok-contrast.test.ts')
  })
})
