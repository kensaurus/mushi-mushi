/**
 * /health round 2 (2026-11-18): one bar of sections where each tab renders its own view
 * ("AI calls" from Unusual spikes stayed on Unusual spikes), grey "No data" for unmeasured code
 * size, open dependency holes as the first (red) row, and no third tab bar before the first scan.
 */

import { describe, expect, it } from 'vitest'
import { healthSectionOptions, healthSectionParams, resolveHealthSection, resolveHealthView } from './HealthSectionsBar'
import { isCodeHealthMetricUnmeasured } from '../code-health/CodeHealthGuide'
import { dependencyHolesLine } from '../../pages/CodeHealthPage'
import { showDriftTabs } from '../../pages/DriftPage'

const qs = (s: string) => new URLSearchParams(s)

describe('one bar of health sections', () => {
  it('lists every section once: the AI & jobs tabs, then the other views', () => {
    expect(healthSectionOptions().map((o) => o.label)).toEqual(['Overview', 'AI calls', 'Scheduled jobs', 'Recent traces', 'Code size', 'Schema changes', 'Unusual spikes'])
    expect(healthSectionOptions(undefined, { cron: 2 }).find((o) => o.id === 'cron')?.count).toBe(2)
  })

  it('opens AI calls from Unusual spikes: picking a tab drops ?view=', () => {
    const from = qs('view=spikes&project=p1')
    const next = healthSectionParams(from, 'llm')
    expect(next.get('view')).toBeNull()
    expect(next.get('tab')).toBe('llm')
    expect(next.get('project')).toBe('p1')
    expect(resolveHealthSection(next)).toBe('llm')
    expect(resolveHealthView(next)).toBe('integrations')
  })

  it('opens a view from a tab: picking a view drops ?tab=', () => {
    const next = healthSectionParams(qs('tab=cron'), 'code')
    expect(next.get('tab')).toBeNull()
    expect(resolveHealthSection(next)).toBe('code')
    expect(resolveHealthSection(healthSectionParams(next, 'overview')).toString()).toBe('overview')
  })

  it('keeps old links: /anomalies → ?view=spikes, and unknown values fall back', () => {
    expect(resolveHealthSection(qs('view=spikes'))).toBe('spikes')
    expect(resolveHealthSection(qs('view=nope&tab=cron'))).toBe('cron')
    expect(resolveHealthSection(qs('tab=nope'))).toBe('overview')
  })
})

describe('code size and schema empty states', () => {
  it('draws unmeasured bundle and god-file rows as "No data", never "Within budget"', () => {
    expect(isCodeHealthMetricUnmeasured('god_file', { hasRun: false })).toBe(true)
    expect(isCodeHealthMetricUnmeasured('bundle', { hasRun: false })).toBe(true)
    expect(isCodeHealthMetricUnmeasured('ingest', { hasRun: false })).toBe(false)
    expect(isCodeHealthMetricUnmeasured('god_file', { hasRun: true })).toBe(false)
  })

  it('makes open dependency holes a problem row, and a clean or unchecked read a plain line', () => {
    const g = (status: string) => ({ status }) as never
    expect(dependencyHolesLine({ available: true, groups: [g('open'), g('open'), g('open')], lastRun: null } as never)).toEqual({
      problem: true,
      text: '3 packages in your dependencies have known security holes.',
      link: 'Fix them on Full-stack audit',
    })
    expect(dependencyHolesLine({ available: true, groups: [g('dismissed')], lastRun: { at: 'x' } } as never)?.problem).toBe(false)
    expect(dependencyHolesLine({ available: false, groups: [], lastRun: null } as never)).toBeNull()
  })

  it('shows no schema tab bar before the first scan, except on the scanner', () => {
    expect(showDriftTabs(0, 'overview')).toBe(false)
    expect(showDriftTabs(0, 'scanner')).toBe(true)
    expect(showDriftTabs(3, 'overview')).toBe(true)
  })
})
