/**
 * BL-076: light-mode `text-warn` on `surface` must clear WCAG AA.
 *
 * Reads the light theme block in apps/admin (not the dark @theme defaults)
 * and measures with the same contrast function the design plane uses.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio, parseCssColor } from '../../supabase/functions/_shared/design-color.ts'

const CSS = readFileSync(
  resolve(__dirname, '../../../../apps/admin/src/styles/base-and-density.css'),
  'utf8',
)

function lightBlock(css: string): string {
  const marker = 'html[data-theme="light"] {'
  const start = css.indexOf(marker)
  if (start < 0) throw new Error('missing light theme block')
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error('unclosed light theme block')
}

function oklchDecl(block: string, name: string): string {
  const m = block.match(new RegExp(`(?:^|\\n)\\s*${name}:\\s*(oklch\\([^)]*\\))`))
  if (!m) throw new Error(`missing ${name} in light theme`)
  return m[1]
}

function color(block: string, name: string) {
  const parsed = parseCssColor(oklchDecl(block, name))
  if (!parsed) throw new Error(`unparsed ${name}`)
  return parsed
}

describe('light warn contrast (BL-076)', () => {
  const block = lightBlock(CSS)
  const warn = color(block, '--color-warn')
  const surface = color(block, '--color-surface')
  const raised = color(block, '--color-surface-raised')
  const overlay = color(block, '--color-surface-overlay')
  const ink = color(block, '--color-warn-fg')

  it('keeps the light amber (hue 80), deepened so text clears AA', () => {
    expect(oklchDecl(block, '--color-warn')).toBe('oklch(0.50 0.18 80)')
  })

  it('clears 4.5:1 as text on surface, raised, and overlay', () => {
    expect(contrastRatio(warn, surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(warn, raised)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(warn, overlay)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(warn, surface)).toBe(5.5)
  })

  it('clears 4.5:1 for warn-fg on the solid fill', () => {
    expect(contrastRatio(ink, warn)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(ink, warn)).toBe(5.87)
  })
})
