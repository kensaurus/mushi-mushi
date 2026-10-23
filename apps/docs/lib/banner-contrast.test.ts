/**
 * The release bar is Nextra's Banner. The version eyebrow used
 * `--mushi-vermillion-ink` (#7a1f15), ~1.74:1 on #171717. It has to clear
 * WCAG AA for small text (4.5:1) against every colour that bar paints.
 * The colours are the Nextra 4.6.1 constants in `banner-contrast.ts`.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  NEXTRA_BANNER_PAINT,
  bannerContrastRatios,
  contrast,
  oklchToRgb,
  parseCssColor,
} from './banner-contrast'

const cssPath = fileURLToPath(new URL('../app/globals.css', import.meta.url))
const layoutPath = fileURLToPath(new URL('../app/layout.tsx', import.meta.url))

const directEyebrow = '<Banner><span className="docs-banner-eyebrow">'

describe('docs release banner eyebrow contrast', () => {
  it('converts the neutral-900 / vermillion-ink pair that failed on the live bar', () => {
    expect(oklchToRgb(0.205, 0, 0)).toEqual([23, 23, 23])
    expect(contrast([0x7a, 0x1f, 0x15], [23, 23, 23])).toBeCloseTo(1.74, 2)
    expect(parseCssColor(NEXTRA_BANNER_PAINT.lightBg)).toEqual([23, 23, 23])
    expect(parseCssColor(NEXTRA_BANNER_PAINT.lightFg)).toEqual([0xf8, 0xfa, 0xfc])
  })

  it('pins the Nextra 4.6.1 banner colours', () => {
    expect(NEXTRA_BANNER_PAINT.version).toBe('4.6.1')
    expect(NEXTRA_BANNER_PAINT.lightBg).toBe('#171717')
    expect(NEXTRA_BANNER_PAINT.lightFg).toBe('#f8fafc')
    expect(NEXTRA_BANNER_PAINT.darkFg).toBe('#ffffff')
    expect([...NEXTRA_BANNER_PAINT.darkBgs].sort()).toEqual(['#212121', '#383838'])
  })

  it('clears 4.5:1 against those colours', () => {
    const ratios = bannerContrastRatios(
      readFileSync(cssPath, 'utf8'),
      readFileSync(layoutPath, 'utf8'),
      NEXTRA_BANNER_PAINT,
    )
    expect(ratios).toHaveLength(1 + NEXTRA_BANNER_PAINT.darkBgs.length)
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('still rejects vermillion-ink on the pinned banner backgrounds', () => {
    const ratios = bannerContrastRatios(
      '.docs-banner-eyebrow { color: #7a1f15; }',
      directEyebrow,
      NEXTRA_BANNER_PAINT,
    )
    expect(Math.max(...ratios)).toBeLessThan(4.5)
  })

  it('does not treat inherit as the banner colour when a wrapper sets a class or style', () => {
    const css = '.docs-banner-eyebrow { color: inherit; }'
    const wrapped = '<Banner><div className="note"><span className="docs-banner-eyebrow">'
    const styled =
      '<Banner><div style={{ color: "#7a1f15" }}><span className="docs-banner-eyebrow">'
    expect(() => bannerContrastRatios(css, wrapped, NEXTRA_BANNER_PAINT)).toThrow(
      /banner type colour/,
    )
    expect(() => bannerContrastRatios(css, styled, NEXTRA_BANNER_PAINT)).toThrow(
      /banner type colour/,
    )

    const ratios = bannerContrastRatios(css, directEyebrow, NEXTRA_BANNER_PAINT)
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('measures an explicit eyebrow colour even when a wrapper is present', () => {
    const ratios = bannerContrastRatios(
      '.docs-banner-eyebrow { color: #f8fafc; }',
      '<Banner><div className="note"><span className="docs-banner-eyebrow">',
      NEXTRA_BANNER_PAINT,
    )
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('does not read Nextra private build output', () => {
    const privateBanner = ['dist', 'client', 'components', 'banner'].join('/')
    const privateTheme = ['nextra-theme-docs', 'style.css'].join('/')
    const readable = (url: URL) =>
      readFileSync(fileURLToPath(url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
    const impl = readable(new URL('./banner-contrast.ts', import.meta.url))
    const testSrc = readable(new URL('./banner-contrast.test.ts', import.meta.url))
    for (const src of [impl, testSrc]) {
      expect(src).not.toContain(privateBanner)
      expect(src).not.toContain(privateTheme)
      expect(src).not.toContain('require' + '.resolve')
      expect(src).not.toContain('create' + 'Require')
    }
    expect(impl).not.toContain(['read', 'FileSync'].join(''))
    expect(impl).not.toContain('node:' + 'fs')
    expect(impl).not.toContain('node:' + 'module')
  })
})
