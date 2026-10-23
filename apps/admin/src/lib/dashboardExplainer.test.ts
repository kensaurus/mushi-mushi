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

  it('uses the Inbox wording when every issue is only degraded', () => {
    const i = deriveDashboardInsight({ ...QUIET, integrationIssues: 2, degradedIntegrations: 2 })
    expect(i.sentence).toBe('2 probes are degraded — slow but not down.')
    expect(i.action?.to).toBe('/health?status=amber')
  })

  it('has no action when all is well', () => {
    expect(deriveDashboardInsight(QUIET).action).toBeUndefined()
  })
})

describe('shouldShowPdcaFlow (QA 169)', () => {
  const base = { isAdvanced: true, renderFullDashboard: true, hasPdcaStages: true, showFirstReportHero: false, loopVisualsHidden: false }
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
  it('hides it while the loop visuals are hidden (Advanced opens on the next step)', () => {
    expect(shouldShowPdcaFlow({ ...base, loopVisualsHidden: true })).toBe(false)
  })
})

describe('deriveDashboardInsight agrees with the To-do page (audit 2026-10-20, B2)', () => {
  const QUIET2 = { openBacklog: 0, fixesInProgress: 0, fixesFailed: 0, integrationIssues: 0, reports14d: 42 }
  it('open critical reports lead the sentence with the same count the To-do card shows', () => {
    const i = deriveDashboardInsight({ ...QUIET2, openCritical14d: 7 })
    expect(i.tone).toBe('warn')
    expect(i.sentence).toMatch(/^7 critical reports need a decision/)
    expect(i.action?.to).toBe('/reports?status=open&severity=critical&days=14')
  })
  it('mentions the untriaged count beside the critical count', () => {
    const i = deriveDashboardInsight({ ...QUIET2, openCritical14d: 1, openBacklog: 3 })
    expect(i.sentence).toContain('1 critical report needs a decision · 3 new reports not yet triaged')
  })
  it('says nothing needs you only when nothing does', () => {
    const i = deriveDashboardInsight({ ...QUIET2, openCritical14d: 0 })
    expect(i.tone).toBe('ok')
    expect(i.sentence).toMatch(/^Nothing needs you right now/)
  })
})

describe('Home and To-do read the same "needs you" number (audit 2026-10-20, B2)', () => {
  it('the Home insight and the To-do first card quote the same critical count from one payload', async () => {
    const { buildInboxCards } = await import('./actionInboxFromDashboard')
    const data = {
      counts: { reports14d: 42, openBacklog: 0, openCritical14d: 7, fixesTotal: 0, openPrs: 0, llmCalls14d: 0, llmTokens14d: 0, llmFailures14d: 0 },
      fixSummary: { total: 0, completed: 0, failed: 0, inProgress: 0, openPrs: 0 },
      integrations: [],
    } as unknown as Parameters<typeof buildInboxCards>[0]
    const card = buildInboxCards(data)[0]?.action
    const insight = deriveDashboardInsight({
      openBacklog: 0,
      openCritical14d: data!.counts!.openCritical14d,
      fixesInProgress: 0,
      fixesFailed: 0,
      integrationIssues: 0,
      reports14d: 42,
    })
    expect(card?.title).toBe('7 critical reports need a decision')
    expect(insight.sentence.startsWith('7 critical reports need a decision')).toBe(true)
    expect(card?.primary).toMatchObject({ to: insight.action?.to })
  })
})
