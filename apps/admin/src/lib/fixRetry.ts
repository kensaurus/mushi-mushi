/**
 * FILE: apps/admin/src/lib/fixRetry.ts
 * PURPOSE: Rules behind Retry, failure-cause filters and the Refresh-from-
 *          GitHub result on /fixes (console QA group C, 2026-10-04).
 *
 *   - QA 241: Retry sent no agent, so a failed Cursor Cloud or GitHub agent
 *     attempt silently re-ran on the project default, and analytics logged
 *     the old agent as if it were reused. The retry dialog now offers the
 *     agent, defaulting to the failed attempt's own when it can run again.
 *   - QA 88: "Refresh from GitHub" never reported a failed CI sync.
 *   - QA 94: a status link without `tab=attempts` landed on Overview.
 */

/** Agents a console retry can request (a subset of ALLOWED_AGENT_OVERRIDES). */
export const RETRY_AGENT_OPTIONS = [
  { value: 'auto', label: 'Project default agent' },
  { value: 'claude_code', label: 'Mushi fix worker (Claude)' },
  { value: 'cursor_cloud', label: 'Cursor Cloud agent' },
  { value: 'github_cloud_agent', label: 'GitHub Copilot coding agent' },
] as const
export type RetryAgent = (typeof RETRY_AGENT_OPTIONS)[number]['value']

/**
 * The agent a retry of this attempt should default to: the same one when the
 * dispatcher can run it again, otherwise the project default. Stored
 * `claude_code_agent` (the GitHub Actions workflow) has no dispatch path.
 */
export function retryAgentFor(storedAgent: string | null | undefined): RetryAgent {
  switch (storedAgent) {
    case 'cursor_cloud':
    case 'github_cloud_agent':
    case 'claude_code':
      return storedAgent
    case 'rest_fix_worker':
    case 'rest_worker':
    case 'llm':
      return 'claude_code'
    default:
      return 'auto'
  }
}

/** One default for several attempts: their shared agent, else the project default. */
export function commonRetryAgent(storedAgents: ReadonlyArray<string | null | undefined>): RetryAgent {
  const picks = new Set(storedAgents.map(retryAgentFor))
  return picks.size === 1 ? [...picks][0]! : 'auto'
}

/** The dispatch body for a retry; 'auto' sends no override. */
export function retryDispatchBody(reportId: string, projectId: string | null, agent: RetryAgent): string {
  return JSON.stringify({ reportId, projectId, ...(agent !== 'auto' ? { agentOverride: agent } : {}) })
}

export interface CiRefreshResult {
  check_run_status?: string | null
  check_run_conclusion?: string | null
}

/** The toast after "Refresh from GitHub", success or failure. */
export function describeCiRefresh(
  res: { ok: boolean; data?: CiRefreshResult | null; error?: { code?: string; message?: string } | null },
): { tone: 'success' | 'error'; title: string; description?: string } {
  if (res.ok) {
    const conclusion = res.data?.check_run_conclusion
    const status = res.data?.check_run_status
    const state = conclusion
      ? `CI ${conclusion.replace(/_/g, ' ')}`
      : status
        ? `CI ${status.replace(/_/g, ' ')}`
        : 'No CI run reported for this PR yet'
    return { tone: 'success', title: 'Synced with GitHub', description: `${state}.` }
  }
  switch (res.error?.code) {
    case 'CI_SYNC_TIMEOUT':
      return { tone: 'error', title: "GitHub didn't answer in time", description: 'Try again in a minute.' }
    case 'FORBIDDEN':
      return { tone: 'error', title: "You can't refresh this fix", description: 'Ask a project owner or admin.' }
    case 'NOT_FOUND':
      return { tone: 'error', title: 'This fix no longer exists', description: 'Reload the page.' }
    case 'SERVER_MISCONFIGURED':
      return { tone: 'error', title: "CI sync isn't set up on this server", description: 'The operator needs to configure the ci-sync function.' }
    default:
      return {
        tone: 'error',
        title: "Couldn't read CI from GitHub",
        description: res.error?.message
          ? `${res.error.message}. Check the GitHub connection in Integrations, then try again.`
          : 'Check the GitHub connection in Integrations, then try again.',
      }
  }
}
