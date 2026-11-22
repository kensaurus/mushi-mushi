import { describe, expect, it } from 'vitest'
import { reportRunStatus } from './reportRunStatus'
import { confidenceBarTone, confidenceCellTint, confidenceTextTone } from './reportMetricViz'
import { severityTileSparkAccent } from './ReportsKpiStrip'
import { SEVERITY_TRAFFIC } from '../../lib/severityTraffic'

describe('reportRunStatus', () => {
  // 897 amber "Classified" rows read as 897 warnings (R2 sweep 2026-11-18).
  it('draws a classified report as settled, not waiting', () => {
    for (const s of ['classified', 'triaged', 'grouped']) expect(reportRunStatus(s)).toBe('idle')
  })
  it('keeps new as waiting, fixing as running, fixed as passed, reopened as failed', () => {
    expect(reportRunStatus('new')).toBe('waiting')
    expect(reportRunStatus('fixing')).toBe('running')
    expect(reportRunStatus('fixed')).toBe('passed')
    expect(reportRunStatus('reopened')).toBe('failed')
  })
})

describe('confidence colour', () => {
  // A red "55%" read as a failure (R2 sweep 2026-11-18).
  it('is never red; low confidence is the amber warning', () => {
    for (const c of [0.1, 0.55, 0.7, 0.95]) {
      expect(`${confidenceBarTone(c)} ${confidenceCellTint(c)} ${confidenceTextTone(Math.round(c * 100))}`).not.toMatch(/danger/)
    }
    expect(confidenceBarTone(0.55)).toBe('bg-warn')
    expect(confidenceBarTone(0.95)).not.toMatch(/warn|ok/)
  })
})

describe('severity tiles', () => {
  // Tiles drew Medium blue / Low grey beside rows in yellow / green (R2 sweep 2026-11-18).
  it('use the one severity palette (lib/severityTraffic)', () => {
    for (const key of ['critical', 'high', 'medium', 'low'] as const) {
      expect(severityTileSparkAccent(key)).toBe(SEVERITY_TRAFFIC[key].bg.replace('bg-', 'text-'))
    }
    expect(severityTileSparkAccent('medium')).toBe('text-sev-medium')
    expect(severityTileSparkAccent('low')).toBe('text-ok')
  })
})
