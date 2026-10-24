/**
 * `text-danger` must clear WCAG AA on the page surfaces it is painted on.
 *
 * Reads the dark @theme block and the light theme override (not a hardcoded
 * swatch). Contrast uses the design-plane function. Gamut is linear sRGB
 * with no channel clamp, so an out-of-gamut token fails here instead of
 * being silently clipped to a different painted colour.
 *
 * Server suite on purpose. Ratios come from `design-color.ts`, the
 * design-plane function (byte-identical with the CLI engine). Admin tests
 * cannot import it: `apps/admin/tsconfig.json` sets `rootDir` to `./src`,
 * and a test under that root that imports this module fails typecheck
 * (TS6059). `light-warn-contrast.test.ts` lives here for the same reason.
 * The danger token comments in the admin stylesheets name this file.
 * `cssBlock` throws if a theme block moves, so a relocated stylesheet
 * fails here instead of passing an empty read.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio, parseCssColor } from '../../supabase/functions/_shared/design-color.ts'

const adminStyles = resolve(__dirname, '../../../../apps/admin/src/styles')
const segmentedControl = resolve(__dirname, '../../../../apps/admin/src/components/ui/forms.tsx')

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

/** The one oklch declaration of `name` in this theme block. */
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

/** L, C, H of one `oklch(L C H)` declaration. Alpha and extra channels fail. */
function parseOklch(decl: string): { L: number; C: number; H: number } {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(decl)
  if (!m) throw new Error(`not oklch: ${decl}`)
  return { L: Number(m[1]), C: Number(m[2]), H: Number(m[3]) }
}

/**
 * OKLCH → linear-light sRGB, unclamped. Same OKLab matrices as
 * design-color.ts, stopping before the sRGB transfer and the 0..1 clamp.
 * A channel outside [0, 1] is outside the sRGB gamut.
 */
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

const DARK = cssBlock(readFileSync(resolve(adminStyles, 'theme-tokens.css'), 'utf8'), '@theme {')
const LIGHT = cssBlock(readFileSync(resolve(adminStyles, 'base-and-density.css'), 'utf8'), 'html[data-theme="light"] {')

describe('danger contrast', () => {
  it('keeps one in-gamut dark red (hue 25)', () => {
    const decl = oklchDecl(DARK, '--color-danger')
    // Hue only. Lightness and chroma may move when contrast and gamut still hold.
    expect(parseOklch(decl).H).toBe(25)
    expectInsideSrgb(decl)
  })

  it('clears 4.5:1 as dark text on surface, raised, and overlay', () => {
    const danger = color(DARK, '--color-danger')
    expect(contrastRatio(danger, color(DARK, '--color-surface'))).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(danger, color(DARK, '--color-surface-raised'))).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(danger, color(DARK, '--color-surface-overlay'))).toBeGreaterThanOrEqual(4.5)
  })

  it('clears 4.5:1 for dark danger-fg on the solid fill', () => {
    expect(contrastRatio(color(DARK, '--color-danger-fg'), color(DARK, '--color-danger'))).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps one in-gamut light red (hue 25)', () => {
    const decl = oklchDecl(LIGHT, '--color-danger')
    expect(parseOklch(decl).H).toBe(25)
    expectInsideSrgb(decl)
  })

  it('clears 4.5:1 as light text on surface, raised, and overlay', () => {
    const danger = color(LIGHT, '--color-danger')
    expect(contrastRatio(danger, color(LIGHT, '--color-surface'))).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(danger, color(LIGHT, '--color-surface-raised'))).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(danger, color(LIGHT, '--color-surface-overlay'))).toBeGreaterThanOrEqual(4.5)
  })

  it('clears 4.5:1 for light danger-fg on the solid fill', () => {
    expect(contrastRatio(color(LIGHT, '--color-danger-fg'), color(LIGHT, '--color-danger'))).toBeGreaterThanOrEqual(4.5)
  })

  it('clears 4.5:1 for danger text on danger-muted in both themes', () => {
    for (const block of [DARK, LIGHT]) {
      expect(contrastRatio(color(block, '--color-danger'), color(block, '--color-danger-muted'))).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('clears 4.5:1 for brand-foreground on the active segment wash in both themes', () => {
    for (const block of [DARK, LIGHT]) {
      expect(
        contrastRatio(color(block, '--color-brand-foreground'), color(block, '--color-brand-subtle')),
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('paints the active segment count with the full brand-foreground token', () => {
    const forms = readFileSync(segmentedControl, 'utf8')
    expect(forms).toContain("active ? 'text-brand-foreground' : 'text-fg-faint'")
    expect(forms).not.toMatch(/text-brand-foreground\/\d+/)
  })

  it('is named from the admin danger token comments', () => {
    expect(DARK).toContain('danger-contrast.test.ts')
    expect(LIGHT).toContain('danger-contrast.test.ts')
  })
})
