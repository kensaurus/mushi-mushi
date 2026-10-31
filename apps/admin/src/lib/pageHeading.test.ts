import { describe, expect, it } from 'vitest'
import { pageSuppliesH1 } from './pageHeading'

describe('pageSuppliesH1', () => {
  it('is true only for /fixes, where the page title is the h1', () => {
    expect(pageSuppliesH1('/fixes')).toBe(true)
    expect(pageSuppliesH1('/fixes/')).toBe(true)
    expect(pageSuppliesH1('/credits')).toBe(false)
    expect(pageSuppliesH1('/fixes/extra')).toBe(false)
    expect(pageSuppliesH1('/')).toBe(false)
  })
})
