import { describe, expect, it } from 'vitest'
import {
  bottleneckActionLabel,
  bottleneckChipLabel,
  bottleneckDeepLink,
  bottleneckHumanHeadline,
  bottleneckHumanHint,
} from './pdcaBottleneck'

describe('pdcaBottleneck human copy', () => {
  it('headline for failed fixes', () => {
    expect(
      bottleneckHumanHeadline({ stage: 'do', label: '2 fixes need retry', count: 2 }),
    ).toBe('Auto-fix stopped on 2 reports')
  })

  it('hint explains retry path', () => {
    expect(bottleneckHumanHint({ stage: 'do', label: '1 fix needs retry' })).toMatch(/retry/i)
  })

  it('action label for multiple failures', () => {
    expect(
      bottleneckActionLabel({ stage: 'do', label: '2 fixes need retry', count: 2 }),
    ).toBe('See why (2)')
  })

  it('chip label is human not P/D/C/A', () => {
    expect(bottleneckChipLabel({ stage: 'do', label: '2 fixes need retry', count: 2 })).toBe(
      '2 fixes stopped',
    )
    expect(bottleneckChipLabel({ stage: 'plan', label: '3 reports waiting', count: 3 })).toBe(
      '3 to triage',
    )
  })
})

describe('per-report server label (2026-10-04)', () => {
  it('reads "N reports still unfixed after an auto-fix attempt" as stopped fixes', () => {
    const ctx = { stage: 'do' as const, label: '3 reports still unfixed after an auto-fix attempt', count: 3 }
    expect(bottleneckHumanHeadline(ctx)).toBe('Auto-fix stopped on 3 reports')
    expect(bottleneckActionLabel(ctx)).toBe('See why (3)')
    expect(bottleneckDeepLink('do', 'proj-1', ctx.label)).toBe('/fixes?project=proj-1&status=failed')
  })
})

describe('bottleneckDeepLink', () => {
  it('adds failed filter for retry bottlenecks', () => {
    expect(bottleneckDeepLink('do', 'proj-1', '2 fixes need retry')).toBe(
      '/fixes?project=proj-1&status=failed',
    )
  })

  it('scopes plan to new reports', () => {
    expect(bottleneckDeepLink('plan', 'proj-1', '3 reports waiting')).toBe(
      '/reports?status=new&project=proj-1',
    )
  })

  it('plain do link without retry label', () => {
    expect(bottleneckDeepLink('do', 'proj-1', '1 fix in flight')).toBe(
      '/fixes?project=proj-1',
    )
  })
})
