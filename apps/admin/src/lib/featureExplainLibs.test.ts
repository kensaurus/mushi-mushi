import { describe, expect, it } from 'vitest'
import { isIntegrationsBannerVisible } from './integrationsExplainer'
import { qaProviderDefinition } from './qaProviderGuide'
import { isReportsBannerVisible, severityDefinition } from './reportsExplainer'
import { inboxStageDefinition } from './inboxExplainer'
import { exploreTabDefinition } from './exploreExplainer'
import { isMcpGuideExpanded } from './mcpExplainer'
import { SKILL_MODE_DEFINITIONS } from './skillsExplainer'
import { isSsoGuideExpanded, ssoProtocolDefinition } from './ssoExplainer'
import { isComplianceGuideExpanded, complianceConceptDefinition } from './complianceExplainer'
import { isDriftGuideExpanded } from './driftExplainer'
import { isAnomaliesGuideExpanded, anomalyMethodDefinition } from './anomaliesExplainer'
import { isCodeHealthGuideExpanded, codeHealthMetricDefinition } from './codeHealthExplainer'
import { isFixesGuideExpanded, fixLifecycleStage } from './fixesExplainer'
import { isProjectsGuideExpanded, projectsHealthSignal } from './projectsExplainer'
import { isConnectGuideExpanded } from './connectExplainer'
import { isHealthGuideExpanded, healthProbeTab } from './healthExplainer'
import { isOnboardingGuideExpanded } from './onboardingExplainer'
import { isRewardsGuideExpanded, rewardsEconomyConcept } from './rewardsExplainer'
import { isDashboardGuideExpanded, dashboardStagePlain } from './dashboardExplainer'

describe('integrationsExplainer', () => {
  it('shows banner when no project or not healthy', () => {
    expect(isIntegrationsBannerVisible('no_project', false)).toBe(true)
    expect(isIntegrationsBannerVisible('incomplete', true)).toBe(true)
    expect(isIntegrationsBannerVisible('healthy', true)).toBe(false)
  })
})

describe('qaProviderGuide', () => {
  it('resolves known providers', () => {
    expect(qaProviderDefinition('browserbase')?.label).toMatch(/Browserbase/)
    expect(qaProviderDefinition('unknown')).toBeUndefined()
  })
})

describe('reportsExplainer', () => {
  it('hides banner when queue is clear', () => {
    expect(isReportsBannerVisible({ hasAnyProject: true, hasIngest: true, topPriority: 'clear' })).toBe(
      false,
    )
    expect(severityDefinition('critical')?.plain).toMatch(/workflow/i)
  })
})

describe('inboxExplainer', () => {
  it('defines all five PDCA stages', () => {
    expect(inboxStageDefinition('plan')?.shortLabel).toBe('Plan')
    expect(inboxStageDefinition('ops')?.examples.length).toBeGreaterThan(0)
  })
})

describe('exploreExplainer', () => {
  it('covers atlas tabs', () => {
    expect(exploreTabDefinition('ask')?.whenToUse).toMatch(/auth/i)
    expect(exploreTabDefinition('missing')).toBeUndefined()
  })
})

describe('mcpExplainer', () => {
  it('expands guide for setup issues', () => {
    expect(isMcpGuideExpanded('never_connected')).toBe(true)
    expect(isMcpGuideExpanded('healthy')).toBe(false)
  })
})

describe('skillsExplainer', () => {
  it('defines handoff and cloud modes', () => {
    expect(SKILL_MODE_DEFINITIONS).toHaveLength(2)
  })
})

describe('ssoExplainer', () => {
  it('expands for setup gaps and defines SAML', () => {
    expect(isSsoGuideExpanded('no_providers')).toBe(true)
    expect(isSsoGuideExpanded('healthy')).toBe(false)
    expect(ssoProtocolDefinition('saml')?.acronym).toBe('SAML')
  })
})

describe('complianceExplainer', () => {
  it('covers DSAR concept and expands on risk', () => {
    expect(complianceConceptDefinition('dsar')?.label).toMatch(/DSAR/)
    expect(isComplianceGuideExpanded('failing_controls')).toBe(true)
    expect(isComplianceGuideExpanded('healthy')).toBe(false)
  })
})

describe('driftExplainer', () => {
  it('expands when findings exist', () => {
    expect(isDriftGuideExpanded('critical_findings')).toBe(true)
    expect(isDriftGuideExpanded('healthy')).toBe(false)
  })
})

describe('anomaliesExplainer', () => {
  it('defines detection methods', () => {
    expect(anomalyMethodDefinition('zscore')?.plain).toMatch(/average/i)
    expect(isAnomaliesGuideExpanded('no_metrics')).toBe(true)
  })
})

describe('codeHealthExplainer', () => {
  it('defines god-file metric', () => {
    expect(codeHealthMetricDefinition('god_file')?.label).toMatch(/God file/)
    expect(isCodeHealthGuideExpanded('no_data')).toBe(true)
  })
})

describe('fixesExplainer', () => {
  it('defines merge stage', () => {
    expect(fixLifecycleStage('merge')?.label).toMatch(/Merge/)
    expect(isFixesGuideExpanded('failed')).toBe(false)
    expect(isFixesGuideExpanded('no_project')).toBe(true)
  })
})

describe('projectsExplainer', () => {
  it('defines ingest signal', () => {
    expect(projectsHealthSignal('ingest')?.plain).toMatch(/bug/)
    expect(isProjectsGuideExpanded('never_ingested')).toBe(true)
  })
})

describe('connectExplainer', () => {
  it('expands when github missing', () => {
    expect(isConnectGuideExpanded({ githubConnected: false, sdkConnected: true })).toBe(true)
    expect(isConnectGuideExpanded({ githubConnected: true, sdkConnected: true })).toBe(false)
  })
})

describe('healthExplainer', () => {
  it('defines LLM tab', () => {
    expect(healthProbeTab('llm')?.label).toMatch(/LLM/)
    expect(isHealthGuideExpanded('llm_errors')).toBe(true)
  })
})

describe('onboardingExplainer', () => {
  it('expands until setup done', () => {
    expect(isOnboardingGuideExpanded({ setupDone: false, hasAnyProject: true })).toBe(true)
    expect(isOnboardingGuideExpanded({ setupDone: true, hasAnyProject: true })).toBe(false)
  })
})

describe('rewardsExplainer', () => {
  it('defines rules concept', () => {
    expect(rewardsEconomyConcept('rules')?.plain).toMatch(/Points/i)
    expect(isRewardsGuideExpanded('no_rules')).toBe(true)
  })
})

describe('dashboardExplainer', () => {
  it('plain stage hints; guide stays collapsed by default', () => {
    expect(dashboardStagePlain('plan')).toMatch(/bug/i)
    expect(isDashboardGuideExpanded()).toBe(false)
  })
})

describe('featureExplainBurndown', () => {
  it('has zero pending or partial routes', async () => {
    const { FEATURE_EXPLAIN_BURNDOWN } = await import('./featureExplainBurndown')
    const incomplete = FEATURE_EXPLAIN_BURNDOWN.filter((i) => i.status !== 'done')
    expect(incomplete).toHaveLength(0)
  })
})
