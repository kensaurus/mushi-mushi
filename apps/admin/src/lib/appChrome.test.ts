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
})
