import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { shouldTooltipNowrap, tooltipLayoutClasses } from './tooltip-layout'

describe('shouldTooltipNowrap', () => {
  it('wraps long explanatory strings by default', () => {
    const byok =
      'All LLM calls run under your own API key — your data never transits the Mushi platform account.'
    expect(shouldTooltipNowrap(byok)).toBe(false)
  })

  it('keeps short icon labels on one line', () => {
    expect(shouldTooltipNowrap('Copy link')).toBe(true)
    expect(shouldTooltipNowrap('Test connection')).toBe(true)
  })

  it('respects explicit nowrap override', () => {
    const long = 'A'.repeat(80)
    expect(shouldTooltipNowrap(long, true)).toBe(true)
    expect(shouldTooltipNowrap('Copy', false)).toBe(false)
  })

  it('wraps ReactNode content by default', () => {
    expect(shouldTooltipNowrap(createElement('span', null, 'nested'))).toBe(false)
  })
})

describe('tooltipLayoutClasses', () => {
  it('maps layout modes to CSS hooks', () => {
    expect(tooltipLayoutClasses(true)).toContain('mushi-tooltip--single')
    expect(tooltipLayoutClasses(false)).toContain('mushi-tooltip--wrap')
  })
})
