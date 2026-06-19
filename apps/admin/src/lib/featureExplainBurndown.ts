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
  { route: '/settings', label: 'Settings', status: 'done', liveData: 'partial', notes: 'SettingsTabIntro per tab; affects list static' },
  { route: '/dashboard', label: 'Dashboard', status: 'done', liveData: 'done', notes: 'DashboardPdcaGuide with live stage counts' },
  { route: '/projects', label: 'Projects', status: 'done', liveData: 'partial', notes: 'ProjectsHubGuide health signals (static defs)' },
  { route: '/reports', label: 'Reports', status: 'done', liveData: 'partial', notes: 'Severity table + banner topPriority*' },
  { route: '/fixes', label: 'Fixes', status: 'done', liveData: 'done', notes: 'FixesPipelineGuide + live fix stats overlays' },
  { route: '/connect', label: 'Connect', status: 'done', liveData: 'done', notes: 'ConnectHubGuide lane overlays + upgrade flag' },
  { route: '/billing', label: 'Billing', status: 'done', liveData: 'done', notes: 'BillingSeatFaqCallout + Callout unlimited seats' },
  { route: '/integrations', label: 'Integrations', status: 'done', liveData: 'partial', notes: 'IntegrationsPageIntro steps + banner stats' },
  { route: '/health', label: 'Health', status: 'done', liveData: 'partial', notes: 'HealthProbesGuide probe defs + banner' },
  { route: '/judge', label: 'Judge', status: 'done', liveData: 'partial', notes: 'JudgePipelineGuide + eval banner' },
  { route: '/qa-coverage', label: 'QA Coverage', status: 'done', liveData: 'partial', notes: 'QaProviderGuideCard provider defs' },
  { route: '/onboarding', label: 'Get started', status: 'done', liveData: 'partial', notes: 'OnboardingStepsGuide + step counts' },
  { route: '/inbox', label: 'Inbox', status: 'done', liveData: 'done', notes: 'InboxPdcaGuide open/clear + clearsWhen' },
  { route: '/explore', label: 'Explore codebase', status: 'done', liveData: 'partial', notes: 'ExploreAtlasGuide tab defs + explore stats banner' },
  { route: '/mcp', label: 'MCP', status: 'done', liveData: 'done', notes: 'McpConnectGuide scopes include cannotDo' },
  { route: '/sso', label: 'SSO', status: 'done', liveData: 'partial', notes: 'SsoProtocolGuide protocol defs' },
  { route: '/compliance', label: 'Compliance', status: 'done', liveData: 'partial', notes: 'ComplianceGuide operator actions' },
  { route: '/rewards', label: 'Rewards', status: 'done', liveData: 'partial', notes: 'RewardsEconomyGuide concept defs' },
  { route: '/cost', label: 'LLM Cost', status: 'done', liveData: 'done', notes: 'CostStageGuide top operation highlight' },
  { route: '/drift', label: 'Drift', status: 'done', liveData: 'partial', notes: 'Drift severity table + banner' },
  { route: '/anomalies', label: 'Anomalies', status: 'done', liveData: 'partial', notes: 'Detection method defs + banner' },
  { route: '/code-health', label: 'Code Health', status: 'done', liveData: 'partial', notes: 'Metric defs + code-health stats banner' },
  { route: '/prompt-lab', label: 'Prompt Lab', status: 'done', liveData: 'partial', notes: 'PromptLabGuide workflow steps' },
  { route: '/skills', label: 'Skills', status: 'done', liveData: 'partial', notes: 'SkillsPipelineGuide mode defs + banner' },
  { route: '/dlq', label: 'Processing Queue', status: 'done', liveData: 'done', notes: 'QueueStatusBanner wired; KPI row explains lanes' },
]
