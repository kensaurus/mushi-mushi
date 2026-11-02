/**
 * The release-banner version label has to clear WCAG AA on Nextra's bar.
 *
 * `.docs-banner-eyebrow` was `--mushi-vermillion-ink` (#7a1f15). Nextra's
 * Banner paints `.nextra-banner` neutral-900 (`oklch(20.5% 0 0)`, #171717)
 * with slate-50 text, and white text over `#383838` → `#212121` in `.dark`.
 * That ink is 1.74:1 on the bar. The label inherits the banner's own text
 * colour, and the `.dark` override is gone so it cannot put a dark red back.
 *
 * Bar colours are pinned from Nextra 4.6's Banner classes and theme tokens.
 * This file does not parse the installed stylesheet.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type Rgb = [number, number, number]

function parseHex(input: string): Rgb {
  const h = input.slice(1)
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG 2 contrast, 1..21. */
function contrast(fg: Rgb, bg: Rgb): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Nextra 4.6 `.nextra-banner`: `bg-neutral-900`, `text-slate-50`,
 * `dark:text-white`, `dark:bg-[linear-gradient(1deg,#383838,#212121)]`.
 */
const NEUTRAL_900 = parseHex('#171717')
const SLATE_50 = parseHex('#f8fafc')
const WHITE = parseHex('#ffffff')
const DARK_GRADIENT = [parseHex('#383838'), parseHex('#212121')] as const

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app/globals.css'), 'utf8')

function ruleBody(selector: string): string {
  const lines = css.split('\n')
  const start = lines.findIndex((line) => line.trim() === `${selector} {`)
  if (start < 0) throw new Error(`missing ${selector}`)
  let depth = 0
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) return lines.slice(start + 1, i).join('\n')
      }
    }
  }
  throw new Error(`unclosed ${selector}`)
}

describe('docs banner eyebrow contrast', () => {
  it('inherits the banner text colour and has no dark-theme colour override', () => {
    const eyebrow = ruleBody('.docs-banner-eyebrow')
    const color = /(?:^|\n)\s*color\s*:\s*([^;]+);/.exec(`\n${eyebrow}`)
    expect(color?.[1].trim()).toBe('inherit')
    expect(eyebrow).not.toContain('--mushi-vermillion')
    expect(css.split('\n').some((line) => line.trim() === '.dark .docs-banner-eyebrow {')).toBe(false)
  })

  it('clears WCAG AA for the text the label inherits on every banner colour', () => {
    for (const background of [NEUTRAL_900, ...DARK_GRADIENT]) {
      expect(contrast(SLATE_50, background)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(WHITE, background)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
