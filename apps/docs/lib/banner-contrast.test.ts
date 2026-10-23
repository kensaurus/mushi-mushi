/**
 * The release bar is Nextra's Banner: neutral-900 with slate-50 type in the
 * light theme, and a #212121–#383838 gradient with white type in dark. The
 * version eyebrow used `--mushi-vermillion-ink` (#7a1f15), ~1.74:1 on
 * #171717. It has to clear WCAG AA for small text (4.5:1) against every
 * colour that bar actually paints.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const cssPath = join(dirname(fileURLToPath(import.meta.url)), '../app/globals.css')

type RGB = [number, number, number]

/** OKLCH → sRGB (Björn Ottosson). Pins below lock the matrix. */
function oklchToRgb(L: number, C: number, H: number): RGB {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return lin.map((c) => {
    const x = Math.min(Math.max(c, 0), 1)
    const g = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
    return Math.round(g * 255)
  }) as RGB
}

function contrast(a: RGB, b: RGB): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const lum = (rgb: RGB) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function parseCssColor(raw: string): RGB {
  const v = raw.trim()
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1]
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB
  }
  const oklch = v.match(/^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)$/i)
  if (oklch) return oklchToRgb(Number(oklch[1]) / 100, Number(oklch[2]), Number(oklch[3]))
  throw new Error(`unsupported CSS color ${v}`)
}

function token(css: string, name: string): RGB {
  const m = css.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))
  if (!m) throw new Error(`missing ${name} in nextra theme css`)
  return parseCssColor(m[1])
}

/** Top-level `color` of `selector`, last rule wins. Null when the rule is absent. */
function colorDecl(css: string, selector: string): string | null {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const want = selector.replace(/\s+/g, ' ').trim()
  let color: string | null = null
  let i = 0
  while (i < stripped.length) {
    const open = stripped.indexOf('{', i)
    if (open < 0) break
    let depth = 1
    let j = open + 1
    while (j < stripped.length && depth > 0) {
      if (stripped[j] === '{') depth++
      else if (stripped[j] === '}') depth--
      j++
    }
    const sel = (stripped.slice(i, open).split(';').pop() ?? '').replace(/\s+/g, ' ').trim()
    if (sel.split(',').map((s) => s.trim()).includes(want)) {
      const declared = stripped.slice(open + 1, j - 1).match(/(?:^|;)\s*color\s*:\s*([^;]+)/)
      if (declared) color = declared[1].replace(/\s*!important\s*$/, '').trim()
    }
    i = j
  }
  return color
}

describe('docs release banner eyebrow contrast', () => {
  it('converts the neutral-900 / vermillion-ink pair that failed on the live bar', () => {
    expect(oklchToRgb(0.205, 0, 0)).toEqual([23, 23, 23])
    expect(contrast([0x7a, 0x1f, 0x15], [23, 23, 23])).toBeCloseTo(1.74, 2)
  })

  it('clears 4.5:1 against the banner Nextra actually paints', () => {
    const nextraRoot = dirname(require.resolve('nextra/package.json'))
    const bannerJs = readFileSync(join(nextraRoot, 'dist/client/components/banner/index.js'), 'utf8')
    const themeCss = readFileSync(require.resolve('nextra-theme-docs/style.css'), 'utf8')
    const paint = bannerJs.match(
      /x:text-slate-50 x:dark:text-white x:bg-neutral-900 x:dark:bg-\[linear-gradient\(1deg,(#[0-9a-fA-F]{6}),(#[0-9a-fA-F]{6})\)\]/,
    )
    expect(paint, 'Nextra Banner paint classes changed').not.toBeNull()

    const lightBg = token(themeCss, '--x-color-neutral-900')
    const lightFg = token(themeCss, '--x-color-slate-50')
    const darkFg = token(themeCss, '--x-color-white')
    const darkBgs = [parseCssColor(paint![1]), parseCssColor(paint![2])]

    const css = readFileSync(cssPath, 'utf8')
    const base = colorDecl(css, '.docs-banner-eyebrow')
    const dark = colorDecl(css, '.dark .docs-banner-eyebrow')
    expect(base, '.docs-banner-eyebrow must set a color').not.toBeNull()

    const fg = (decl: string | null, themeFg: RGB): RGB => {
      if (decl == null || decl === 'inherit' || decl === 'currentColor') return themeFg
      return parseCssColor(decl)
    }

    expect(contrast(fg(base, lightFg), lightBg)).toBeGreaterThanOrEqual(4.5)
    for (const bg of darkBgs) {
      expect(contrast(fg(dark ?? base, darkFg), bg)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
