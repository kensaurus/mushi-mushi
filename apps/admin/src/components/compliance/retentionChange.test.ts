import { describe, expect, it } from 'vitest'
import { describeNewPolicy, describeRetentionChange } from './retentionChange'

describe('describeRetentionChange', () => {
  it('warns that a shorter window deletes data', () => {
    const text = describeRetentionChange('reports_retention_days', 365, 1, 'Glot', false)
    expect(text).toContain('Glot will keep reports for 1 days instead of 365.')
    expect(text).toMatch(/permanently deleted/)
  })

  it('says nothing is deleted while the project is on legal hold', () => {
    const text = describeRetentionChange('audit_retention_days', 730, 30, 'Glot', true)
    expect(text).toMatch(/legal hold/)
    expect(text).not.toMatch(/permanently deleted/)
  })
})

describe('describeNewPolicy', () => {
  it('names the audit sweeps a new policy starts', () => {
    const text = describeNewPolicy('Glot', 90)
    expect(text).toContain('90 days')
    expect(text).toContain('730 days')
    expect(text).toContain('365 days')
  })
})
