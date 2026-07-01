/**
 * Feature-explanation UX burndown — every admin route/subpage.
 * status: done = plain-language intro + field help; partial = some sections;
 * pending = jargon-heavy or no "what this does" copy.
 * liveData: done = WorkflowStageRow + backend overlays; partial = guide only;
 * pending = static copy without live metrics.
 */

export type FeatureExplainStatus = 'done' | 'partial' | 'pending'
export type FeatureExplainLiveDataStatus = 'done' | 'partial' | 'pending'

export interface FeatureExplainBurndownItem {
  route: string
  label: string
  status: FeatureExplainStatus
  liveData: FeatureExplainLiveDataStatus
  notes: string
}

export const FEATURE_EXPLAIN_BURNDOWN: FeatureExplainBurndownItem[] = [
  { route: '/organization/members', label: 'Members', status: 'done', liveData: 'done', notes: 'Role guide + Callout seat FAQ + semantic icons' },
  { route: '/settings', label: 'Settings', status: 'done', liveData: 'done', notes: 'SettingsTabIntro + settingsTabOverlay from tab-local probe flags' },
  { route: '/dashboard', label: 'Dashboard', status: 'done', liveData: 'done', notes: 'DashboardPdcaGuide with live stage counts' },
  { route: '/projects', label: 'Projects', status: 'done', liveData: 'done', notes: 'ProjectsHubGuide + projectsHealthOverlay' },
  { route: '/reports', label: 'Reports', status: 'done', liveData: 'done', notes: 'ReportsTriageGuide + reportsSeverityOverlay' },
  { route: '/fixes', label: 'Fixes', status: 'done', liveData: 'done', notes: 'FixesPipelineGuide + live fix stats overlays' },
  { route: '/connect', label: 'Connect', status: 'done', liveData: 'done', notes: 'ConnectHubGuide lane overlays + upgrade flag' },
  { route: '/billing', label: 'Billing', status: 'done', liveData: 'done', notes: 'BillingSeatFaqCallout + Callout unlimited seats' },
  { route: '/integrations', label: 'Integrations', status: 'done', liveData: 'done', notes: 'IntegrationsPageIntro + integrationsStepOverlay' },
  { route: '/health', label: 'Health', status: 'done', liveData: 'done', notes: 'HealthProbesGuide + healthProbeOverlay' },
  { route: '/judge', label: 'Judge', status: 'done', liveData: 'done', notes: 'JudgePipelineGuide + judgeStageOverlay' },
  { route: '/qa-coverage', label: 'QA Coverage', status: 'done', liveData: 'done', notes: 'QaProviderGuideCard + qaProviderOverlay' },
  { route: '/onboarding', label: 'Get started', status: 'done', liveData: 'done', notes: 'OnboardingStepsGuide + onboardingStepOverlay' },
  { route: '/inbox', label: 'Inbox', status: 'done', liveData: 'done', notes: 'InboxPdcaGuide open/clear + clearsWhen' },
  { route: '/explore', label: 'Explore codebase', status: 'done', liveData: 'done', notes: 'ExploreAtlasGuide + exploreTabOverlay' },
  { route: '/mcp', label: 'MCP', status: 'done', liveData: 'done', notes: 'McpConnectGuide scopes include cannotDo' },
  { route: '/sso', label: 'SSO', status: 'done', liveData: 'done', notes: 'SsoProtocolGuide + ssoProtocolOverlay' },
  { route: '/compliance', label: 'Compliance', status: 'done', liveData: 'done', notes: 'ComplianceGuide + complianceConceptOverlay' },
  { route: '/rewards', label: 'Rewards', status: 'done', liveData: 'done', notes: 'RewardsEconomyGuide + rewardsConceptOverlay' },
  { route: '/cost', label: 'LLM Cost', status: 'done', liveData: 'done', notes: 'CostStageGuide top operation highlight' },
  { route: '/drift', label: 'Drift', status: 'done', liveData: 'done', notes: 'DriftSchemaGuide severity strip + driftSeverityOverlay' },
  { route: '/anomalies', label: 'Anomalies', status: 'done', liveData: 'done', notes: 'AnomaliesDetectionGuide + anomaliesMethodOverlay' },
  { route: '/code-health', label: 'Code Health', status: 'done', liveData: 'done', notes: 'CodeHealthGuide + codeHealthMetricOverlay' },
  { route: '/prompt-lab', label: 'Prompt Lab', status: 'done', liveData: 'done', notes: 'PromptLabGuide + promptLabStageOverlay' },
  { route: '/skills', label: 'Skills', status: 'done', liveData: 'done', notes: 'SkillsPipelineGuide + skillsModeOverlay' },
  { route: '/dlq', label: 'Processing Queue', status: 'done', liveData: 'done', notes: 'QueueStatusBanner wired; KPI row explains lanes' },
]
