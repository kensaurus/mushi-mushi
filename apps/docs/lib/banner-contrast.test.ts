/**
 * The release bar is Nextra's Banner. The version eyebrow used
 * `--mushi-vermillion-ink` (#7a1f15), ~1.74:1 on #171717. It has to clear
 * WCAG AA for small text (4.5:1) against every colour that bar paints.
 *
 * Banner paint pinned to Nextra 4.6.1: light is neutral-900 #171717 with
 * slate-50 #f8fafc type, dark is a #383838–#212121 gradient with white type.
 * Re-check these when bumping `nextra-theme-docs` past 4.6.1.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const BANNER = {
  light: { fg: '#f8fafc', bgs: ['#171717'] },
  dark: { fg: '#ffffff', bgs: ['#383838', '#212121'] },
} as const

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

/** Last `color` declared by a top-level rule whose whole selector is `selector`. */
function declaredColor(selector: string): string | null {
  const sel = selector.replace(/\./g, '\\.').replace(/\s+/g, '\\s+')
  let color: string | null = null
  for (const [, body] of css.matchAll(new RegExp(`(?<=^|\\})\\s*${sel}\\s*\\{([^}]*)\\}`, 'g'))) {
    const decl = body.match(/(?:^|;)\s*color\s*:\s*([^;]+)/)
    if (decl) color = decl[1].replace(/\s*!important\s*$/, '').trim()
  }
  return color
}

/** `inherit` (or no rule) is the bar's own type colour; anything else must be a literal. */
function resolve(declared: string | null, bannerFg: string): string {
  if (declared == null || declared === 'inherit' || declared === 'currentColor') return bannerFg
  if (!/^#[0-9a-f]{6}$/i.test(declared)) {
    throw new Error(`.docs-banner-eyebrow color "${declared}" must be inherit or a #rrggbb literal`)
  }
  return declared
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('docs release banner eyebrow contrast', () => {
  it('measures the reported vermillion-ink on the light bar at ~1.74:1', () => {
    expect(contrast('#7a1f15', BANNER.light.bgs[0])).toBeCloseTo(1.74, 2)
  })

  const base = declaredColor('.docs-banner-eyebrow')
  it.each([
    ['light', BANNER.light, base],
    ['dark', BANNER.dark, declaredColor('.dark .docs-banner-eyebrow') ?? base],
  ] as const)('clears 4.5:1 on the %s bar', (_, paint, declared) => {
    const fg = resolve(declared, paint.fg)
    for (const bg of paint.bgs) expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
  })
})
