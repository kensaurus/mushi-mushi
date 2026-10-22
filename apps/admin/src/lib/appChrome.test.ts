import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('appChrome shell tokens', () => {
  it('wires --chrome-row-height into overlay offset and top-row utility', () => {
    const tokens = readFileSync(resolve(__dirname, '../styles/theme-tokens.css'), 'utf8')
    const components = readFileSync(resolve(__dirname, '../styles/components.css'), 'utf8')
    expect(tokens).toContain('--chrome-row-height: 2.5rem')
    expect(components).toContain('.chrome-top-row')
    expect(components).toMatch(/min-height:\s*var\(--chrome-row-height/)
  })

  it('exports sub-header offset from chrome row height token', async () => {
    const { DESKTOP_SUBHEADER_OFFSET } = await import('./appChrome')
    expect(DESKTOP_SUBHEADER_OFFSET).toContain('--chrome-row-height')
  })

  it('writes each overlay offset class out in full, so Tailwind generates it', async () => {
    const { drawerBelowAppChromeClass, stageDrawerBelowAppChromeClass, mobileNavBelowAppChromeClass, DESKTOP_SUBHEADER_OFFSET } =
      await import('./appChrome')
    const source = readFileSync(resolve(__dirname, './appChrome.ts'), 'utf8')
    for (const cls of [drawerBelowAppChromeClass, stageDrawerBelowAppChromeClass, mobileNavBelowAppChromeClass]) {
      const tokens = cls.split(/\s+/)
      const mdTop = tokens.find((t) => t.startsWith('md:top-['))
      expect(mdTop).toContain(DESKTOP_SUBHEADER_OFFSET)
      for (const t of tokens) {
        // A bracket left open means a space split one arbitrary value in two.
        expect(t.split('[').length, t).toBe(t.split(']').length)
        if (t.includes('[')) expect(source, `${t} must appear literally in appChrome.ts`).toContain(t)
      }
    }
  })
})
