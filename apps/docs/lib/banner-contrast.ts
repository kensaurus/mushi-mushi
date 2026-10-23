/**
 * Contrast of the docs release-banner eyebrow against the bar Nextra paints.
 *
 * Pinned to Nextra 4.6.1 (`nextra` and `nextra-theme-docs`). Light mode is
 * neutral-900 `#171717` with slate-50 `#f8fafc` (theme token
 * `--x-color-slate-50`, `oklch(98.4% 0.003 247.858)`). Dark mode is
 * `linear-gradient(1deg, #383838, #212121)` with white `#ffffff`.
 * Re-check these when bumping either package past 4.6.1. They are constants
 * so a class-order or private-path change in a later Nextra build does not
 * fail the check while the painted colours stay the same.
 */
type RGB = [number, number, number]

export const NEXTRA_BANNER_PAINT = {
  version: '4.6.1',
  lightBg: '#171717',
  lightFg: '#f8fafc',
  darkFg: '#ffffff',
  darkBgs: ['#383838', '#212121'],
} as const

type BannerPaint = {
  lightBg: string
  lightFg: string
  darkFg: string
  darkBgs: readonly string[]
}

/** OKLCH → sRGB (Björn Ottosson). Pins below lock the matrix. */
export function oklchToRgb(L: number, C: number, H: number): RGB {
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

export function contrast(a: RGB, b: RGB): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const lum = (rgb: RGB) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

export function parseCssColor(raw: string): RGB {
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
    if (
      sel
        .split(',')
        .map((s) => s.trim())
        .includes(want)
    ) {
      const declared = stripped.slice(open + 1, j - 1).match(/(?:^|;)\s*color\s*:\s*([^;]+)/)
      if (declared) color = declared[1].replace(/\s*!important\s*$/, '').trim()
    }
    i = j
  }
  return color
}

/**
 * True when something between `<Banner>` and the eyebrow element sets
 * `className` or `style`. `color: inherit` on the eyebrow is the banner's
 * own type colour only while that parent chain does not — a wrapper class
 * or inline style can paint a different colour, and this file does not
 * compute it.
 */
function eyebrowInheritsThroughWrapper(layoutSrc: string): boolean {
  const eye = layoutSrc.lastIndexOf('docs-banner-eyebrow')
  if (eye < 0) throw new Error('missing docs-banner-eyebrow')
  const tagStart = layoutSrc.lastIndexOf('<', eye)
  const bannerStart = layoutSrc.lastIndexOf('<Banner', tagStart)
  if (bannerStart < 0 || tagStart < 0) {
    throw new Error('docs-banner-eyebrow is not inside <Banner>')
  }
  const between = layoutSrc.slice(bannerStart, tagStart)
  return /className\s*=|style\s*=/.test(between)
}

/**
 * `inherit` / `currentColor` resolve to `bannerFg` — the banner's own type
 * colour — only when `layoutSrc` does not put a classed or styled wrapper
 * between `<Banner>` and the eyebrow. Otherwise the rendered colour is the
 * wrapper's, and this throws instead of reporting the banner colour.
 */
function eyebrowForeground(decl: string | null, bannerFg: RGB, layoutSrc: string): RGB {
  if (decl == null || decl === 'inherit' || decl === 'currentColor') {
    if (eyebrowInheritsThroughWrapper(layoutSrc)) {
      throw new Error(
        'docs-banner-eyebrow inherits its colour, but a wrapper between <Banner> and the ' +
          'eyebrow sets className or style. Inherit is not the banner type colour.',
      )
    }
    return bannerFg
  }
  return parseCssColor(decl)
}

/** Contrast ratios: light background first, then each dark gradient stop. */
export function bannerContrastRatios(css: string, layoutSrc: string, paint: BannerPaint): number[] {
  const base = colorDecl(css, '.docs-banner-eyebrow')
  if (base == null) throw new Error('.docs-banner-eyebrow must set a color')
  const dark = colorDecl(css, '.dark .docs-banner-eyebrow')
  const light = contrast(
    eyebrowForeground(base, parseCssColor(paint.lightFg), layoutSrc),
    parseCssColor(paint.lightBg),
  )
  const darkFg = eyebrowForeground(dark ?? base, parseCssColor(paint.darkFg), layoutSrc)
  return [light, ...paint.darkBgs.map((bg) => contrast(darkFg, parseCssColor(bg)))]
}
