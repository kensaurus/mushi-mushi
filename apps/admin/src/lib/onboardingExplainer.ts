/**
 * Plain-language onboarding / setup steps guide.
 */

export interface OnboardingStepDefinition {
  id: string
  label: string
  plain: string
  optional?: boolean
}

export const ONBOARDING_REQUIRED_STEPS: OnboardingStepDefinition[] = [
  {
    id: 'project_created',
    label: 'Create project',
    plain: 'Name the app Mushi should watch — one project per mobile app, web app, or environment.',
  },
  {
    // Canonical live setup-step IDs (see useSetupStatus / SetupChecklist):
    // keep these in lock-step so this guide can be matched against DB step
    // state without silent drift.
    id: 'api_key_generated',
    label: 'Mint API key',
    plain: 'Copy the report key into your app env — without it the SDK cannot send bugs.',
  },
  {
    id: 'sdk_installed',
    label: 'SDK connected',
    plain: 'Install @mushi-mushi/react (or your stack SDK) and confirm a heartbeat appears here.',
  },
  {
    id: 'first_report_received',
    label: 'First report',
    plain: 'Send a test bug from the widget or the “Send test report” button to confirm reports arrive.',
  },
]

export const ONBOARDING_OPTIONAL_STEPS: OnboardingStepDefinition[] = [
  {
    id: 'github',
    label: 'Connect GitHub',
    plain: 'Unlock auto-fix PRs and upgrade jobs.',
    optional: true,
  },
  {
    id: 'slack',
    label: 'Slack routing',
    plain: 'Post new-bug alerts to a channel.',
    optional: true,
  },
  {
    id: 'qa',
    label: 'First QA story',
    plain: 'Schedule a user-story smoke test.',
    optional: true,
  },
  {
    id: 'mcp',
    label: 'MCP in Cursor',
    plain: 'Let your editor read reports and fix briefs.',
    optional: true,
  },
]

export const ONBOARDING_EXPLAINER_SUMMARY =
  'Get started walks the four required steps — project, API key, SDK heartbeat, first report — before optional GitHub, Slack, QA, and MCP polish.'

export function isOnboardingGuideExpanded(stats: {
  setupDone: boolean
  hasAnyProject: boolean
}): boolean {
  return !stats.hasAnyProject || !stats.setupDone
}
