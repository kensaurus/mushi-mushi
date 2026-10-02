/**
 * FILE: packages/server/supabase/functions/_shared/design-color.ts
 * PURPOSE: Pure colour maths for the design plane (Plan 019 Phase 1b):
 *          parse CSS colour literals (hex, rgb, hsl, hwb, oklab, oklch),
 *          WCAG 2.x contrast ratios, and OKLab distance for "nearest token"
 *          suggestions. No dependencies.
 */

export interface Rgba {
  /** sRGB channels, 0..1 */
  r: number
  g: number
  b: number
  /** alpha, 0..1 */
  a: number
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA` (case-insensitive). */
export function parseHex(input: string): Rgba | null {
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(input.trim())
  if (!m) return null
  let h = m[1]
  if (h.length <= 4) h = h.split('').map((c) => c + c).join('')
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) : 1 }
}

function toHexByte(v: number): string {
  return Math.round(clamp01(v) * 255).toString(16).padStart(2, '0').toUpperCase()
}

/** `#RRGGBB`, or `#RRGGBBAA` when alpha < 1. */
export function toHex(c: Rgba): string {
  const base = `#${toHexByte(c.r)}${toHexByte(c.g)}${toHexByte(c.b)}`
  return c.a < 1 ? `${base}${toHexByte(c.a)}` : base
}

/** Parses a CSS number / percentage. `scale` is what 100% maps to. */
function num(token: string, scale: number): number | null {
  const t = token.trim()
  if (t === 'none') return 0
  const pct = /^(-?[\d.]+)%$/.exec(t)
  if (pct) return (Number(pct[1]) / 100) * scale
  const deg = /^(-?[\d.]+)(deg|turn|rad|grad)?$/.exec(t)
  if (!deg) return null
  const v = Number(deg[1])
  if (!Number.isFinite(v)) return null
  switch (deg[2]) {
    case 'turn': return v * 360
    case 'rad': return (v * 180) / Math.PI
    case 'grad': return v * 0.9
    default: return v
  }
}

/** Split `a, b, c / d` or `a b c / d` into channel tokens and an alpha token. */
function splitArgs(body: string): { parts: string[]; alpha: string | null } {
  const [main, alpha] = body.split('/')
  const parts = main.includes(',') ? main.split(',') : main.trim().split(/\s+/)
  const cleaned = parts.map((p) => p.trim()).filter(Boolean)
  // Legacy `rgba(r, g, b, a)` carries alpha as a fourth comma part.
  if (alpha === undefined && cleaned.length === 4) return { parts: cleaned.slice(0, 3), alpha: cleaned[3] }
  return { parts: cleaned, alpha: alpha?.trim() ?? null }
}

function alphaOf(token: string | null): number {
  if (token == null) return 1
  const v = num(token, 1)
  return v == null ? 1 : clamp01(v)
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

const linearToSrgb = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)
const srgbToLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))

function oklabToRgb(L: number, A: number, B: number): [number, number, number] {
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B
  const s_ = L - 0.0894841775 * A - 1.291485548 * B
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

/** sRGB → OKLab [L, a, b]. */
export function rgbToOklab(c: Rgba): [number, number, number] {
  const r = srgbToLinear(c.r), g = srgbToLinear(c.g), b = srgbToLinear(c.b)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/**
 * Parse a CSS colour literal. Tailwind arbitrary values use `_` for spaces,
 * so underscores are read as spaces. Returns null for anything it cannot
 * resolve to sRGB (named colours, `var()`, relative colour syntax, lab/lch).
 */
export function parseCssColor(input: string): Rgba | null {
  const s = input.trim().replace(/_/g, ' ')
  if (s.startsWith('#')) return parseHex(s)
  const fn = /^(rgba?|hsla?|hwb|oklab|oklch)\(\s*([^()]*)\)$/i.exec(s)
  if (!fn) return null
  const kind = fn[1].toLowerCase()
  const { parts, alpha } = splitArgs(fn[2])
  if (parts.length !== 3) return null
  const a = alphaOf(alpha)
  if (kind === 'rgb' || kind === 'rgba') {
    const ch = parts.map((p) => num(p, 255))
    if (ch.some((v) => v == null)) return null
    const [r, g, b] = ch as number[]
    return { r: clamp01(r / 255), g: clamp01(g / 255), b: clamp01(b / 255), a }
  }
  if (kind === 'hsl' || kind === 'hsla' || kind === 'hwb') {
    const h = num(parts[0], 360)
    const x = num(parts[1].endsWith('%') ? parts[1] : `${parts[1]}%`, 1)
    const y = num(parts[2].endsWith('%') ? parts[2] : `${parts[2]}%`, 1)
    if (h == null || x == null || y == null) return null
    const hue = ((h % 360) + 360) % 360
    if (kind === 'hwb') {
      const w = clamp01(x), bl = clamp01(y)
      if (w + bl >= 1) { const grey = w / (w + bl); return { r: grey, g: grey, b: grey, a } }
      const [r, g, b] = hslToRgb(hue, 1, 0.5).map((v) => v * (1 - w - bl) + w)
      return { r, g, b, a }
    }
    const [r, g, b] = hslToRgb(hue, clamp01(x), clamp01(y))
    return { r, g, b, a }
  }
  // oklab / oklch: L is 0..1 (or %), a/b/C use 100% = 0.4.
  const L = num(parts[0], 1)
  if (L == null) return null
  if (kind === 'oklab') {
    const A = num(parts[1], 0.4), B = num(parts[2], 0.4)
    if (A == null || B == null) return null
    const [r, g, b] = oklabToRgb(L, A, B)
    return { r: clamp01(r), g: clamp01(g), b: clamp01(b), a }
  }
  const C = num(parts[1], 0.4), H = num(parts[2], 360)
  if (C == null || H == null) return null
  const rad = (H * Math.PI) / 180
  const [r, g, b] = oklabToRgb(L, C * Math.cos(rad), C * Math.sin(rad))
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b), a }
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(c: Rgba): number {
  return 0.2126 * srgbToLinear(c.r) + 0.7152 * srgbToLinear(c.g) + 0.0722 * srgbToLinear(c.b)
}

/** Composite a translucent foreground over an opaque background. */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  }
}

/** WCAG contrast ratio, 1..21, rounded to 2 decimals. Translucent fg is composited. */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const f = fg.a < 1 ? composite(fg, { ...bg, a: 1 }) : fg
  const L1 = relativeLuminance(f)
  const L2 = relativeLuminance({ ...bg, a: 1 })
  const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
  return Math.round(ratio * 100) / 100
}

/** Perceptual distance (OKLab Euclidean ×100). Alpha differences add 50 per unit. */
export function colorDistance(x: Rgba, y: Rgba): number {
  const [l1, a1, b1] = rgbToOklab(x)
  const [l2, a2, b2] = rgbToOklab(y)
  const d = Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2) * 100
  return Math.round((d + Math.abs(x.a - y.a) * 50) * 100) / 100
}

/** Same sRGB to 8-bit precision (the alpha is compared separately by callers). */
export function sameRgb(x: Rgba, y: Rgba): boolean {
  return toHex({ ...x, a: 1 }) === toHex({ ...y, a: 1 })
}
