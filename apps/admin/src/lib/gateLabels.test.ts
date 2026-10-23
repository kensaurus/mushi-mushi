import { describe, expect, it } from 'vitest'
import { gateLabel } from './gateLabels'

const GATE_IDS = [
  'dead_handler',
  'mock_leak',
  'api_contract',
  'crawl',
  'status_claim',
  'spec_drift',
  'orphan_endpoint',
  'unknown_call',
  'schema_drift',
  'code_health',
  'design_drift',
  'ci_drift',
  'deploy_drift',
  'env_drift',
  'radar',
  'portfolio_radar',
  'portfolio_radar_ci',
  'portfolio_radar_vulns',
  'store_review',
] as const

describe('gateLabel', () => {
  it('names every gate in plain English, with no internal codename', () => {
    for (const id of GATE_IDS) {
      const label = gateLabel(id)
      expect(label, id).not.toMatch(/\(G\d+\)/)
      expect(label, id).not.toBe(id)
    }
  })

  it('names dead handlers without a gate number', () => {
    expect(gateLabel('dead_handler')).toBe('Dead handlers')
  })
})
