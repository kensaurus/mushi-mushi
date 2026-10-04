/**
 * Dashboard banners carry their fix (2026-10-04 audit: "1 integration needs
 * attention — notifications or CI may be degraded." named nothing and
 * linked nowhere).
 */
import { describe, expect, it } from 'vitest'
import { deriveDashboardInsight, shouldShowPdcaFlow } from './dashboardExplainer'

const QUIET = { openBacklog: 0, fixesInProgress: 0, fixesFailed: 0, integrationIssues: 0, reports14d: 6 }

describe('deriveDashboardInsight', () => {
  it('names the failing integration and links to it', () => {
    const i = deriveDashboardInsight({ ...QUIET, integrationIssues: 1, failingIntegrations: [{ kind: 'sentry', label: 'Sentry' }] })
    expect(i.sentence).toContain('Sentry needs attention')
    expect(i.action).toEqual({ label: 'Fix Sentry', to: '/integrations/config#sentry' })
  })

  it('lists several integrations by name', () => {
    const i = deriveDashboardInsight({
      ...QUIET,
      integrationIssues: 2,
      failingIntegrations: [{ kind: 'sentry', label: 'Sentry' }, { kind: 'github', label: 'GitHub' }],
    })
    expect(i.sentence).toContain('Sentry and GitHub need attention')
    expect(i.action?.to).toBe('/integrations/config#sentry')
  })

  it('counts stopped fixes per report and links to them', () => {
    const i = deriveDashboardInsight({ ...QUIET, fixesFailed: 1 })
    expect(i.sentence).toContain('Auto-fix stopped on 1 report')
    expect(i.action?.to).toBe('/fixes?tab=attempts&status=failed')
  })

  it('has no action when all is well', () => {
    expect(deriveDashboardInsight(QUIET).action).toBeUndefined()
  })
})

describe('shouldShowPdcaFlow (QA 169)', () => {
  const base = { isAdvanced: true, renderFullDashboard: true, hasPdcaStages: true, showFirstReportHero: false }
  it('shows the live canvas in advanced mode even though the insight banner always has a verdict', () => {
    expect(deriveDashboardInsight(QUIET)).not.toBeNull()
    expect(shouldShowPdcaFlow(base)).toBe(true)
  })
  it('hides it in quick mode, before setup, with no stages, or under the first-report hero', () => {
    expect(shouldShowPdcaFlow({ ...base, isAdvanced: false })).toBe(false)
    expect(shouldShowPdcaFlow({ ...base, renderFullDashboard: false })).toBe(false)
    expect(shouldShowPdcaFlow({ ...base, hasPdcaStages: false })).toBe(false)
    expect(shouldShowPdcaFlow({ ...base, showFirstReportHero: true })).toBe(false)
  })
})
