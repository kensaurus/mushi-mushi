import { describe, expect, it } from 'vitest'
import { integrationPillStatus } from './integrationPill'

describe('integrationPillStatus (audit 2026-10-20, B4)', () => {
  it('a healthy last probe with most probes failing is degraded, not healthy', () => {
    expect(integrationPillStatus('ok', 0.03)).toBe('degraded')
    expect(integrationPillStatus('ok', 0.44)).toBe('degraded')
  })

  it('a healthy last probe with a healthy window is healthy', () => {
    expect(integrationPillStatus('ok', 1)).toBe('ok')
    expect(integrationPillStatus('ok', 0.97)).toBe('ok')
    expect(integrationPillStatus('ok', null)).toBe('ok')
  })

  it('down and degraded probes keep their word', () => {
    expect(integrationPillStatus('down', 1)).toBe('down')
    expect(integrationPillStatus('red', 1)).toBe('down')
    expect(integrationPillStatus('degraded', 1)).toBe('degraded')
  })

  it('no probe yet is unknown', () => {
    expect(integrationPillStatus(null, null)).toBe('unknown')
    expect(integrationPillStatus(undefined, 0.5)).toBe('unknown')
  })
})
