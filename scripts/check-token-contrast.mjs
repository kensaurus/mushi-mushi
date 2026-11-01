#!/usr/bin/env node
/**
 * CI gate: compute real WCAG contrast ratios for the operator console's token
 * pairs, in BOTH themes, from the token files themselves.
 *
 * Why: every other design gate pattern-matches class strings. None computes a
 * ratio, so a token edit that made a pair unreadable passed all of them. The
 * 2026-09-23 console pass found, among others: a black switch knob (thumb =
 * `fg`, which is near-black in light mode), dark text on the violet accent
 * button, amber `brand-subtle` under vermillion text, and dark-mode `fg-faint`
 * lighter than `fg-muted`. The axe-based e2e spec cannot see these either
 * (colour-contrast is rated "serious", it skips gradients, disabled controls
 * and non-text contrast, and the e2e job is opt-in).
 *
 * Source of truth: apps/admin/src/styles/theme-tokens.css (@theme = dark
 * base), base-and-density.css (html[data-theme="light"] overrides) and
 * packages/brand/src/editorial.css (:root --mushi-* primitives).
 *
 * Supported value forms: #hex, rgb()/rgba(), oklch(L C H[/a]), var(--x),
 * color-mix(in oklab|srgb, A p%, B), white/black/transparent. A pair whose
 * value cannot be resolved FAILS (never silently passes).
 *
 * Usage: node scripts/check-token-contrast.mjs [--print]
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8')
const PRINT = process.argv.includes('--print')

// ── token extraction ───────────────────────────────────────────────────────
function declsIn(block) {
  const out = {}
  for (const m of block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim()
  }
  return out
}
function blockAfter(css, selectorRe) {
  const m = css.match(selectorRe)
  if (!m) throw new Error(`block not found: ${selectorRe}`)
  let i = css.indexOf('{', m.index) + 1
  let depth = 1
  const start = i
  for (; i < css.length && depth > 0; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') depth--
  }
  return css.slice(start, i - 1)
}

const brandRoot = declsIn(blockAfter(read('packages/brand/src/editorial.css'), /:root\s*\{/))
const darkTheme = declsIn(blockAfter(read('apps/admin/src/styles/theme-tokens.css'), /@theme\s*\{/))
const lightOverrides = declsIn(
  blockAfter(read('apps/admin/src/styles/base-and-density.css'), /html\[data-theme="light"\]\s*\{/),
)
const THEMES = {
  dark: { ...brandRoot, ...darkTheme },
  light: { ...brandRoot, ...darkTheme, ...lightOverrides },
}

// ── colour maths (CSS Color 4) ─────────────────────────────────────────────
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
function oklabToLinearSrgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v)))
}
function linearSrgbToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}
/** Colour = { lin: [r,g,b] linear sRGB, alpha } */
function fromSrgb8(r, g, b, alpha = 1) {
  return { lin: [r, g, b].map((v) => srgbToLinear(v / 255)), alpha }
}

function resolveColor(value, theme, depth = 0) {
  if (depth > 12) throw new Error(`var() cycle at ${value}`)
  const v = value.trim()
  if (v === 'white') return fromSrgb8(255, 255, 255)
  if (v === 'black') return fromSrgb8(0, 0, 0)
  if (v === 'transparent') return { lin: [0, 0, 0], alpha: 0 }
  let m
  if ((m = v.match(/^var\(--([a-z0-9-]+)\)$/))) {
    const next = theme[m[1]]
    if (next === undefined) throw new Error(`undefined token --${m[1]}`)
    return resolveColor(next, theme, depth + 1)
  }
  if ((m = v.match(/^#([0-9a-f]{3,8})$/i))) {
    let h = m[1]
    if (h.length <= 4) h = [...h].map((c) => c + c).join('')
    const n = (i) => parseInt(h.slice(i, i + 2), 16)
    return fromSrgb8(n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1)
  }
  if ((m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/))) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
    return fromSrgb8(+m[1], +m[2], +m[3], a)
  }
  if ((m = v.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?))?\s*\)$/))) {
    const L = parseFloat(m[1]) / (m[2] ? 100 : 1)
    const C = parseFloat(m[3])
    const H = (parseFloat(m[4]) * Math.PI) / 180
    const a = m[5] === undefined ? 1 : m[5].endsWith('%') ? parseFloat(m[5]) / 100 : parseFloat(m[5])
    return { lin: oklabToLinearSrgb([L, C * Math.cos(H), C * Math.sin(H)]), alpha: a }
  }
  if ((m = v.match(/^color-mix\(in (oklab|srgb),\s*(.+)\)$/))) {
    const [pa, pb] = splitTopLevel(m[2])
    const [ca, wa] = parseMixPart(pa)
    const [cb, wb] = parseMixPart(pb)
    const A = resolveColor(ca, theme, depth + 1)
    const B = resolveColor(cb, theme, depth + 1)
    const p = wa ?? (wb !== undefined ? 1 - wb : 0.5)
    const alpha = A.alpha * p + B.alpha * (1 - p)
    const mixIn = (x) => (m[1] === 'oklab' ? linearSrgbToOklab(x) : x.map((c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)))
    const back = (x) => (m[1] === 'oklab' ? oklabToLinearSrgb(x) : x.map(srgbToLinear))
    // premultiplied interpolation (CSS Color 5)
    const xa = mixIn(A.lin).map((c) => c * A.alpha)
    const xb = mixIn(B.lin).map((c) => c * B.alpha)
    const mixed = xa.map((c, i) => (c * p + xb[i] * (1 - p)) / (alpha || 1))
    return { lin: back(mixed), alpha }
  }
  throw new Error(`unsupported colour value: ${v}`)
}
function splitTopLevel(s) {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++
    else if (s[i] === ')') depth--
    else if (s[i] === ',' && depth === 0) return [s.slice(0, i).trim(), s.slice(i + 1).trim()]
  }
  throw new Error(`bad color-mix args: ${s}`)
}
function parseMixPart(part) {
  const m = part.match(/^(.*?)(?:\s+([\d.]+)%)?$/)
  return [m[1].trim(), m[2] === undefined ? undefined : parseFloat(m[2]) / 100]
}
/** Composite `fg` over an opaque `bg` (straight alpha, linear light is fine for a gate). */
function over(fg, bg) {
  return { lin: fg.lin.map((c, i) => c * fg.alpha + bg.lin[i] * (1 - fg.alpha)), alpha: 1 }
}
const luminance = ({ lin: [r, g, b] }) => 0.2126 * r + 0.7152 * g + 0.0722 * b
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// ── pair table ─────────────────────────────────────────────────────────────
// [foreground token, background token, minimum ratio, what it guards]
const TEXT = 4.5
const UI = 3
const PAIRS = [
  ['fg', 'surface', TEXT, 'body text on the page'],
  ['fg', 'surface-raised', TEXT, 'body text on cards'],
  ['fg-secondary', 'surface-raised', TEXT, 'secondary copy'],
  ['fg-muted', 'surface-raised', TEXT, 'muted copy / labels'],
  ['fg-muted', 'surface', TEXT, 'muted copy on the page'],
  ['fg-faint', 'surface-raised', TEXT, 'helper / timestamp copy'],
  ['fg-faint', 'surface-overlay', TEXT, 'disabled-button label on its neutral well'],
  ['brand-fg', 'brand', TEXT, 'primary button label'],
  ['brand-foreground', 'surface-raised', TEXT, 'brand-coloured copy'],
  ['brand-foreground', 'brand-subtle', TEXT, 'brand chip text on its wash'],
  ['ok-foreground', 'surface-raised', TEXT, 'success copy'],
  ['ok-foreground', 'ok-muted', TEXT, 'success chip text'],
  ['warning-foreground', 'surface-raised', TEXT, 'warning copy'],
  ['warning-foreground', 'warn-muted', TEXT, 'warning chip text'],
  ['danger-foreground', 'surface-raised', TEXT, 'danger copy'],
  ['danger-foreground', 'danger-muted', TEXT, 'danger chip text'],
  ['info-foreground', 'surface-raised', TEXT, 'info copy / links'],
  ['info-foreground', 'info-muted', TEXT, 'info chip text'],
  ['accent-foreground', 'surface-raised', TEXT, 'panel-header links'],
  ['accent-foreground', 'accent-muted', TEXT, 'accent chip text'],
  ['fg-secondary', 'chrome', TEXT, 'help / guide chrome copy'],
  ['brand', 'surface-raised', UI, 'switch on-track, focus ring, active rail stub'],
  ['switch-thumb', 'edge', 1.5, 'switch knob visible on the off track'],
]

const failures = []
const rows = []
for (const [themeName, theme] of Object.entries(THEMES)) {
  for (const [fgName, bgName, min, why] of PAIRS) {
    try {
      const bg = resolveColor(`var(--color-${bgName})`, theme)
      const bgOpaque = bg.alpha < 1 ? over(bg, resolveColor('var(--color-surface-raised)', theme)) : bg
      const fg = over(resolveColor(`var(--color-${fgName})`, theme), bgOpaque)
      const ratio = contrast(fg, bgOpaque)
      rows.push(`${themeName.padEnd(5)} ${fgName.padEnd(20)} on ${bgName.padEnd(16)} ${ratio.toFixed(2).padStart(5)}  (≥${min})  ${why}`)
      if (ratio < min) failures.push(`  ${themeName}: ${fgName} on ${bgName} = ${ratio.toFixed(2)}:1, needs ${min}:1 — ${why}`)
    } catch (err) {
      failures.push(`  ${themeName}: ${fgName} on ${bgName} — could not resolve (${err.message})`)
    }
  }
  // Text hierarchy: each step must read quieter than the one above it.
  try {
    const bg = resolveColor('var(--color-surface-raised)', theme)
    const steps = ['fg', 'fg-secondary', 'fg-muted', 'fg-faint'].map((n) => [n, contrast(resolveColor(`var(--color-${n})`, theme), bg)])
    for (let i = 1; i < steps.length; i++) {
      if (steps[i][1] > steps[i - 1][1]) {
        failures.push(`  ${themeName}: ${steps[i][0]} (${steps[i][1].toFixed(2)}) is louder than ${steps[i - 1][0]} (${steps[i - 1][1].toFixed(2)}) — text hierarchy inverted`)
      }
    }
  } catch (err) {
    failures.push(`  ${themeName}: text hierarchy — ${err.message}`)
  }
}

if (PRINT) console.log(rows.join('\n'))
if (failures.length > 0) {
  console.error(`[fail] ${failures.length} token contrast problem(s):`)
  for (const f of failures) console.error(f)
  process.exit(1)
}
console.log(`[ok] ${PAIRS.length} token pairs × 2 themes meet their contrast minimums; text hierarchy ordered`)
