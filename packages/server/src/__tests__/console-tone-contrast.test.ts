/**
 * The console's tone scale (apps/admin/src/lib/chipTone.ts CHIP_TONE) clears
 * WCAG in every theme: text on its tinted fill at least 4.5:1 (1.4.3), the
 * chip's inset edge at least 3:1 on the surfaces a chip sits on (1.4.11), and
 * the intent fills (Fix red, Triage amber) at least 4.5:1 for their ink.
 * The edge is Tailwind's `inset-ring` layer, never `ring-inset`, which would
 * also turn the buttons' `focus-visible:ring-2` focus ring inward (asserted below).
 *
 * 2026-11-27 (owner: "bare background colour text … really bad"): every chip
 * got an edge in its own hue, and Fix / Triage became solid intent colours.
 * This reads the recipes from chipTone.ts and forms.tsx and the token values
 * from the admin stylesheets, so a recipe or token change is measured, not a
 * hardcoded swatch. Server suite for the same reason as danger-contrast.test.ts
 * (the admin rootDir cannot import design-color.ts).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio, parseCssColor, type Rgba } from '../../supabase/functions/_shared/design-color.ts'

const admin = resolve(__dirname, '../../../../apps/admin/src')
const read = (rel: string) => readFileSync(resolve(admin, rel), 'utf8')

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

function declarations(block: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of block.matchAll(/(?:^|\n)\s*(--color-[\w-]+):\s*([^;]+);/g)) out.set(m[1], m[2].trim())
  return out
}

const DARK = declarations(cssBlock(read('styles/theme-tokens.css'), '@theme {'))
const base = read('styles/base-and-density.css')
const LIGHT = new Map([...DARK, ...declarations(cssBlock(base, 'html[data-theme="light"] {'))])
const HIGH_CONTRAST = new Map([...DARK, ...declarations(cssBlock(base, 'html[data-theme="high-contrast"] {'))])
const THEMES = { dark: DARK, light: LIGHT, 'high-contrast': HIGH_CONTRAST } as const

/** A token's colour in a theme, following `var(--color-x)` aliases. */
function token(theme: Map<string, string>, name: string, seen: string[] = []): Rgba {
  const key = name.startsWith('--color-') ? name : `--color-${name}`
  const raw = theme.get(key)
  if (!raw) throw new Error(`${key} is not defined`)
  const alias = /^var\((--color-[\w-]+)\)$/.exec(raw)
  if (alias) {
    if (seen.includes(alias[1])) throw new Error(`alias loop at ${alias[1]}`)
    return token(theme, alias[1], [...seen, key])
  }
  const c = parseCssColor(raw)
  if (!c) throw new Error(`${key}: cannot parse ${raw}`)
  return c
}

/** CHIP_TONE entries as written in chipTone.ts: fill, ink and edge token names. */
function chipRecipes(): Array<{ name: string; bg: string; text: string; edge: string }> {
  const src = read('lib/chipTone.ts')
  const body = cssBlock(src, 'export const CHIP_TONE = {')
  const out = []
  for (const m of body.matchAll(/(\w+):\s*'bg-([\w-]+) text-([\w-]+) inset-ring inset-ring-([\w-]+)'/g)) {
    out.push({ name: m[1], bg: m[2], text: m[3], edge: m[4] })
  }
  return out
}

const SURFACES = ['surface', 'surface-raised', 'surface-overlay'] as const

describe('console tone scale (CHIP_TONE)', () => {
  const recipes = chipRecipes()

  it('never uses ring-inset (it would flip focus rings inward)', () => {
    expect(cssBlock(read('lib/chipTone.ts'), 'export const CHIP_TONE = {')).not.toMatch(/ring-inset/)
    expect(read('components/ui/forms.tsx')).not.toMatch(/ring-inset ring-[\w-]+-edge/)
  })

  it('reads every recipe as fill + ink + inset edge', () => {
    // ok, warn, danger, info, accent, brand, medium, neutral
    expect(recipes.map((r) => r.name).sort()).toEqual(
      ['accent', 'brand', 'danger', 'info', 'medium', 'neutral', 'ok', 'warn'].sort(),
    )
    for (const r of recipes) expect(r.edge).toMatch(/-edge$/)
  })

  for (const [themeName, theme] of Object.entries(THEMES)) {
    for (const r of recipes) {
      it(`${themeName} ${r.name}: ink on fill ≥ 4.5:1`, () => {
        expect(contrastRatio(token(theme, r.text), token(theme, r.bg))).toBeGreaterThanOrEqual(4.5)
      })
      it(`${themeName} ${r.name}: edge ≥ 3:1 on surface, raised and overlay`, () => {
        for (const s of SURFACES) {
          expect(contrastRatio(token(theme, r.edge), token(theme, s))).toBeGreaterThanOrEqual(3)
        }
      })
    }
  }
})

describe('intent fills (lib/actionIntent.ts → Btn fix / triage)', () => {
  const forms = read('components/ui/forms.tsx')

  it('Fix is the solid danger red and Triage the amber fill, each with its edge', () => {
    expect(forms).toMatch(/fix:\s*\n?\s*'bg-danger text-danger-fg [^']*inset-ring-danger-edge/)
    expect(forms).toMatch(/triage:\s*\n?\s*'bg-warn-fill text-warn-fill-fg [^']*inset-ring-warn-edge/)
  })

  for (const [themeName, theme] of Object.entries({ dark: DARK, light: LIGHT })) {
    it(`${themeName}: Fix ink on red ≥ 4.5:1`, () => {
      expect(contrastRatio(token(theme, 'danger-fg'), token(theme, 'danger'))).toBeGreaterThanOrEqual(4.5)
    })
    it(`${themeName}: Triage ink on amber ≥ 4.5:1 (dark ink, never white on yellow)`, () => {
      expect(contrastRatio(token(theme, 'warn-fill-fg'), token(theme, 'warn-fill'))).toBeGreaterThanOrEqual(4.5)
      // The ink is the dark end: darker than the fill.
      const ink = token(theme, 'warn-fill-fg')
      const fill = token(theme, 'warn-fill')
      expect(ink.r + ink.g + ink.b).toBeLessThan(fill.r + fill.g + fill.b)
    })
  }
})

describe('selected segment (SegmentedControl)', () => {
  const forms = read('components/ui/forms.tsx')

  it('is a raised tile with an accent edge, not a tinted word', () => {
    expect(forms).toContain("'bg-segment-active text-fg font-semibold inset-ring inset-ring-accent-edge shadow-card'")
    expect(forms).toContain('bg-segment-track')
  })

  for (const [themeName, theme] of Object.entries({ dark: DARK, light: LIGHT })) {
    it(`${themeName}: label ≥ 4.5:1 on the tile, edge ≥ 3:1 on the track`, () => {
      expect(contrastRatio(token(theme, 'fg'), token(theme, 'segment-active'))).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(token(theme, 'accent-foreground'), token(theme, 'segment-active'))).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(token(theme, 'accent-edge'), token(theme, 'segment-track'))).toBeGreaterThanOrEqual(3)
    })
  }
})

describe('secondary and meta text (rows, Kbd, freshness)', () => {
  for (const [themeName, theme] of Object.entries(THEMES)) {
    it(`${themeName}: fg-secondary, fg-muted and fg-faint ≥ 4.5:1 on every surface`, () => {
      for (const fg of ['fg-secondary', 'fg-muted', 'fg-faint']) {
        for (const s of SURFACES) {
          expect(contrastRatio(token(theme, fg), token(theme, s))).toBeGreaterThanOrEqual(4.5)
        }
      }
    })
  }
})
