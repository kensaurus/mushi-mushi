import { describe, expect, it } from 'vitest'
import { inventoryFindingsEnabled } from './inventoryReadout'

describe('inventoryFindingsEnabled', () => {
  it('loads findings for the tabs that render them, including Drift', () => {
    expect(inventoryFindingsEnabled('drift')).toBe(true)
    expect(inventoryFindingsEnabled('gates')).toBe(true)
    expect(inventoryFindingsEnabled('stories')).toBe(true)
  })

  it('skips tabs that do not use them', () => {
    expect(inventoryFindingsEnabled('yaml')).toBe(false)
    expect(inventoryFindingsEnabled('discovery')).toBe(false)
  })
})
