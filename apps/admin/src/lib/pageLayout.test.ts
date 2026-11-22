import { describe, expect, it } from 'vitest'
import { PAGE_SHELL_CLASS, pageLayoutWidthForPath } from './pageLayout'

describe('pageLayoutWidthForPath', () => {
  it('gives monitoring pages the wide shell', () => {
    expect(pageLayoutWidthForPath('/ci')).toBe('wide')
  })

  it('keeps canvases fluid', () => {
    expect(pageLayoutWidthForPath('/explore')).toBe('fluid')
    expect(pageLayoutWidthForPath('/explore/graph')).toBe('fluid')
    expect(pageLayoutWidthForPath('/graph')).toBe('fluid')
  })

  it('keeps everything else on the readable cap, prefix matches included', () => {
    expect(pageLayoutWidthForPath('/settings')).toBe('standard')
    expect(pageLayoutWidthForPath('/connect')).toBe('standard')
    // A prefix is a whole path segment: /cinema is not /ci.
    expect(pageLayoutWidthForPath('/cinema')).toBe('standard')
  })

  it('has a shell class for every width', () => {
    expect(PAGE_SHELL_CLASS.standard).toContain('92rem')
    expect(PAGE_SHELL_CLASS.wide).toContain('160rem')
    expect(PAGE_SHELL_CLASS.fluid).toContain('max-w-none')
  })
})
