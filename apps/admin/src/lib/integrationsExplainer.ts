/**
 * Plain-language intro for the Integrations hub — what to wire first and why.
 */

export interface IntegrationsExplainer {
  title: string
  summary: string
  steps: Array<{ label: string; detail: string }>
}

export const INTEGRATIONS_EXPLAINER: IntegrationsExplainer = {
  title: 'What integrations do in the bug-fix loop',
  summary:
    'Mushi does not replace your stack — it connects to tools you already use. Wire GitHub first so approved fixes become draft PRs, then add Sentry and Langfuse so triage sees real production context.',
  steps: [
    {
      label: '1. GitHub (required for auto-fix)',
      detail:
        'Install the Mushi GitHub App and paste your repo URL. Without this, fixes may generate but never reach a pull request.',
    },
    {
      label: '2. Sentry (recommended)',
      detail:
        'Pulls stack traces and Seer hints into each report so the classifier knows what actually broke in production.',
    },
    {
      label: '3. Langfuse (optional)',
      detail:
        'Attaches LLM trace metadata to reports and fix attempts — useful for auditing prompt cost and quality.',
    },
    {
      label: '4. Routing destinations',
      detail:
        'Fan triaged bugs to Jira, Linear, GitHub Issues, or PagerDuty when your team lives outside Mushi.',
    },
    {
      label: '5. Slack',
      detail:
        'Posts triage alerts, fix updates, and QA failures to a channel your team already watches.',
    },
  ],
}

/** Whether the integrations banner should show above the healthy OK state. */
export function isIntegrationsBannerVisible(
  topPriority: string | undefined,
  hasAnyProject: boolean,
): boolean {
  if (!hasAnyProject) return true
  return topPriority !== 'healthy'
}
