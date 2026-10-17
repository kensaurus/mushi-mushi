import { describe, expect, it } from 'vitest'
import { isIntegrationsBannerVisible } from './integrationsExplainer'
import { QA_PROVIDER_DEFINITIONS } from './qaProviderGuide'
import { isReportsBannerVisible, TRIAGE_SEVERITY_DEFINITIONS } from './reportsExplainer'
import { INBOX_PDCA_STAGES } from './inboxExplainer'
import { EXPLORE_ATLAS_TABS } from './exploreExplainer'
import { isMcpGuideExpanded } from './mcpExplainer'
import { SKILL_MODE_DEFINITIONS } from './skillsExplainer'
import { isSsoGuideExpanded, SSO_PROTOCOL_DEFINITIONS } from './ssoExplainer'
import { isComplianceGuideExpanded, COMPLIANCE_CONCEPT_DEFINITIONS } from './complianceExplainer'
import { isDriftGuideExpanded } from './driftExplainer'
import { isAnomaliesGuideExpanded, ANOMALY_METHOD_DEFINITIONS } from './anomaliesExplainer'
import { isCodeHealthGuideExpanded, CODE_HEALTH_METRIC_DEFINITIONS } from './codeHealthExplainer'
import { isFixesGuideExpanded, FIX_LIFECYCLE_STAGES } from './fixesExplainer'
import { isProjectsGuideExpanded, PROJECTS_HEALTH_SIGNALS } from './projectsExplainer'
import { isHealthGuideExpanded, HEALTH_PROBE_TABS } from './healthExplainer'
import { isOnboardingGuideExpanded } from './onboardingExplainer'
import { isRewardsGuideExpanded, REWARDS_ECONOMY_CONCEPTS } from './rewardsExplainer'
import { PDCA_STAGES } from './pdca'

describe('integrationsExplainer', () => {
  it('shows banner when no project or not healthy', () => {
    expect(isIntegrationsBannerVisible('no_project', false)).toBe(true)
    expect(isIntegrationsBannerVisible('incomplete', true)).toBe(true)
    expect(isIntegrationsBannerVisible('healthy', true)).toBe(false)
  })
})

describe('qaProviderGuide', () => {
  it('resolves known providers', () => {
    expect(QA_PROVIDER_DEFINITIONS.find((p) => p.id === 'browserbase')?.label).toMatch(/Browserbase/)
  })
})

describe('reportsExplainer', () => {
  it('hides banner when queue is clear', () => {
    expect(isReportsBannerVisible({ hasAnyProject: true, hasIngest: true, topPriority: 'clear' })).toBe(
      false,
    )
    expect(TRIAGE_SEVERITY_DEFINITIONS.find((d) => d.id === 'critical')?.plain).toMatch(/workflow/i)
  })
})

describe('inboxExplainer', () => {
  it('defines all five PDCA stages', () => {
    expect(INBOX_PDCA_STAGES.find((d) => d.id === 'plan')?.shortLabel).toBe('Plan')
    expect(INBOX_PDCA_STAGES.find((d) => d.id === 'ops')?.examples.length).toBeGreaterThan(0)
  })
})

describe('exploreExplainer', () => {
  it('covers atlas tabs', () => {
    expect(EXPLORE_ATLAS_TABS.find((t) => t.id === 'ask')?.whenToUse).toMatch(/auth/i)
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
    expect(SSO_PROTOCOL_DEFINITIONS.find((p) => p.id === 'saml')?.acronym).toBe('SAML')
  })
})

describe('complianceExplainer', () => {
  it('covers DSAR concept and expands on risk', () => {
    expect(COMPLIANCE_CONCEPT_DEFINITIONS.find((c) => c.id === 'dsar')?.label).toMatch(/DSAR/)
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
    expect(ANOMALY_METHOD_DEFINITIONS.find((m) => m.id === 'zscore')?.plain).toMatch(/average/i)
    expect(isAnomaliesGuideExpanded('no_metrics')).toBe(true)
  })
})

describe('codeHealthExplainer', () => {
  it('defines god-file metric', () => {
    expect(CODE_HEALTH_METRIC_DEFINITIONS.find((m) => m.id === 'god_file')?.label).toMatch(/God file/)
    expect(isCodeHealthGuideExpanded('no_data')).toBe(true)
  })
})

describe('fixesExplainer', () => {
  it('defines merge stage', () => {
    expect(FIX_LIFECYCLE_STAGES.find((s) => s.id === 'merge')?.label).toMatch(/Merge/)
    expect(isFixesGuideExpanded('failed')).toBe(false)
    expect(isFixesGuideExpanded('no_project')).toBe(true)
  })
})

describe('projectsExplainer', () => {
  it('defines ingest signal', () => {
    expect(PROJECTS_HEALTH_SIGNALS.find((s) => s.id === 'ingest')?.plain).toMatch(/bug/)
    expect(isProjectsGuideExpanded('never_ingested')).toBe(true)
  })
})

describe('healthExplainer', () => {
  it('defines LLM tab', () => {
    expect(HEALTH_PROBE_TABS.find((t) => t.id === 'llm')?.label).toMatch(/LLM/)
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
    expect(REWARDS_ECONOMY_CONCEPTS.find((c) => c.id === 'rules')?.plain).toMatch(/Points/i)
    expect(isRewardsGuideExpanded('no_rules')).toBe(true)
  })
})

describe('dashboard PDCA stage copy', () => {
  it('gives the plan stage a plain hint', () => {
    expect(PDCA_STAGES.plan.hint).toMatch(/bug/i)
  })
})
