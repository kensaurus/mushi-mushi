/**
 * Release-banner version label must clear WCAG AA on Nextra's bar.
 *
 * `.docs-banner-eyebrow` used `--mushi-vermillion-ink` (#7a1f15). Nextra's
 * `<Banner>` paints `.nextra-banner` with `bg-neutral-900` (oklch 20.5% 0,
 * #171717) and `text-slate-50`, and in `.dark` white text over
 * #212121–#383838. That ink is 1.74:1 on the bar. The label inherits the
 * banner's own text colour instead. The `.dark` override is gone so a
 * theme-only mix cannot put a dark red back on the same bar.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contrastRatio, parseCssColor, type Rgba } from '../../../packages/server/supabase/functions/_shared/design-color'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, '../app/globals.css'), 'utf8')
const brand = readFileSync(join(here, '../../../packages/brand/src/editorial.css'), 'utf8')

const requireFromDocs = createRequire(join(here, '../package.json'))
const nextraRoot = dirname(requireFromDocs.resolve('nextra/package.json'))
const banner = readFileSync(join(nextraRoot, 'dist/client/components/banner/index.js'), 'utf8')
const nextraCss = readFileSync(requireFromDocs.resolve('nextra-theme-docs/style.css'), 'utf8')

function ruleBody(source: string, selector: string): string {
  const lines = source.split('\n')
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

function decl(block: string, prop: string): string {
  const match = new RegExp(`(?:^|\\n)\\s*${prop}\\s*:\\s*([^;]+);`).exec(`\n${block}`)
  if (!match) throw new Error(`missing ${prop}`)
  return match[1].trim()
}

function color(input: string): Rgba {
  const parsed = parseCssColor(input)
  if (!parsed) throw new Error(`unparsed colour: ${input}`)
  return parsed
}

describe('docs banner eyebrow contrast', () => {
  const eyebrow = ruleBody(css, '.docs-banner-eyebrow')
  const root = ruleBody(brand, ':root')
  const neutral900 = color(decl(nextraCss, '--x-color-neutral-900'))
  const slate50 = color(decl(nextraCss, '--x-color-slate-50'))
  const white = color(decl(nextraCss, '--x-color-white'))
  const vermillionInk = color(decl(root, '--mushi-vermillion-ink'))
  const darkEnd = color('#212121')
  const lightEnd = color('#383838')

  it('inherits the banner text colour instead of vermillion ink', () => {
    expect(decl(eyebrow, 'color')).toBe('inherit')
    expect(eyebrow).not.toContain('--mushi-vermillion')
    expect(css.split('\n').some((line) => line.trim() === '.dark .docs-banner-eyebrow {')).toBe(false)
  })

  it('reads the colours off the shipped Banner element', () => {
    expect(banner).toContain('x:text-slate-50 x:dark:text-white x:bg-neutral-900 x:dark:bg-[linear-gradient(1deg,#383838,#212121)]')
    expect(banner).toContain('x:w-full x:text-center x:font-medium x:text-sm x:py-2.5')
  })

  it('clears WCAG AA for the text the label inherits, on every bar colour', () => {
    for (const background of [neutral900, darkEnd, lightEnd]) {
      expect(contrastRatio(slate50, background)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(white, background)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('rejects vermillion ink on the neutral-900 bar the report measured', () => {
    expect(contrastRatio(neutral900, color('#171717'))).toBe(1)
    expect(contrastRatio(vermillionInk, color('#171717'))).toBe(1.74)
    expect(contrastRatio(vermillionInk, neutral900)).toBeLessThan(4.5)
  })
})
