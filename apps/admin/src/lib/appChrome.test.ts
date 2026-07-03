import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('appChrome shell tokens', () => {
  it('wires --chrome-row-height into overlay offset and top-row utility', () => {
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8')
    expect(css).toContain('--chrome-row-height: 2.5rem')
    expect(css).toContain('.chrome-top-row')
    expect(css).toMatch(/min-height:\s*var\(--chrome-row-height/)
  })

  it('exports sub-header offset from chrome row height token', async () => {
    const { DESKTOP_SUBHEADER_OFFSET } = await import('./appChrome')
    expect(DESKTOP_SUBHEADER_OFFSET).toContain('--chrome-row-height')
  })
})
