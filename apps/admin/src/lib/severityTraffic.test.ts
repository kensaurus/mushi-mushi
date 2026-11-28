/**
 * Severity colours follow red → amber → yellow → green, one colour each
 * (2026-10-04 audit: medium used `brand`, the same red as critical).
 */
import { describe, expect, it } from 'vitest'
import { SEVERITY_TRAFFIC } from './severityTraffic'
import { severityChipTone } from './chipTone'

describe('SEVERITY_TRAFFIC', () => {
  it('gives every severity its own fill', () => {
    const fills = Object.values(SEVERITY_TRAFFIC).map((v) => v.bg)
    expect(new Set(fills).size).toBe(fills.length)
  })

  it('maps critical → red, high → amber, medium → yellow, low → green', () => {
    expect(SEVERITY_TRAFFIC.critical.bg).toBe('bg-danger')
    expect(SEVERITY_TRAFFIC.high.bg).toBe('bg-warn')
    expect(SEVERITY_TRAFFIC.medium.bg).toBe('bg-sev-medium')
    expect(SEVERITY_TRAFFIC.low.bg).toBe('bg-ok')
  })

  it('never paints medium in the brand red', () => {
    expect(SEVERITY_TRAFFIC.medium.bg).not.toContain('brand')
    expect(severityChipTone('medium')).not.toContain('brand')
  })
})
