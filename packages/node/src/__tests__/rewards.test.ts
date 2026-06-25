import { describe, it, expect } from 'vitest'
import { createMushiRewardsHandler } from '../rewards.js'

describe('createMushiRewardsHandler', () => {
  it('rejects empty signing secret at construction', () => {
    expect(() => createMushiRewardsHandler({ secret: '' })).toThrow(/secret is required/)
    expect(() => createMushiRewardsHandler({ secret: '   ' })).toThrow(/secret is required/)
  })
})
