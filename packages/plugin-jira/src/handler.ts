import { createPluginHandler, type MushiEventEnvelope } from '@mushi-mushi/plugin-sdk'
import { JiraClient } from './client.js'
import type { JiraTokens } from './oauth.js'

export interface JiraPluginOptions {
  /** Mushi webhook secret shared with the plugin row. */
  secret: string
  /** Jira OAuth tokens for the installing user. */
  tokens: JiraTokens
  /** Jira project key to open new issues under (e.g. "BUG"). */
  jiraProjectKey: string
  /**
   * Mushi report status → Jira transition name mapping. Defaults align
   * with Jira's default Bug workflow (`To Do → In Progress → Done`).
   */
  statusToTransition?: Record<string, string>
  /** Map Mushi severity → Jira priority (not set by default). */
  severityToPriority?: Record<string, string>
}

/**
 * Bidirectional Mushi ↔ Jira plugin handler.
 *
 * Inbound (from Mushi → Jira):
 *   report.created       → create Jira issue, stash (reportId, issueKey)
 *   report.classified    → update summary / description / labels
 *   report.status_changed → transition Jira issue
 *   fix.applied          → comment "Fix applied: <pr-url>"
 *
 * Outbound (from Jira → Mushi) lives in `./jira-webhook.ts` — that one
 * verifies Atlassian's webhook signature and POSTs back to the Mushi REST
 * API to mirror status / comment changes.
 */
export function createJiraPluginHandler(opts: JiraPluginOptions) {
  const jira = new JiraClient(opts.tokens)
  const statusMap: Record<string, string> = {
    pending: 'To Do',
    classified: 'To Do',
    grouped: 'To Do',
    fixing: 'In Progress',
    fixed: 'Done',
    dismissed: 'Done',
    ...(opts.statusToTransition ?? {}),
  }
  // Cross-process mapping of mushiReportId → jiraIssueKey would normally
  // live in Postgres. The handler stays stateless; the caller injects
  // `resolveIssueKey` so tests can plug in a fake store.
  const issueKeyByReportId = new Map<string, string>()

  return createPluginHandler({
    secret: opts.secret,
    on: {
      'report.created': async (e: MushiEventEnvelope) => {
        const data = e.data as { report: { id: string; title?: string; category?: string; severity?: string } }
        const issue = await jira.createIssue({
          projectKey: opts.jiraProjectKey,
          summary: data.report.title ?? `[Mushi] Report ${data.report.id.slice(0, 8)}`,
          description: `Auto-created by Mushi Mushi.\nReport: mushi://reports/${data.report.id}`,
          mushiReportId: data.report.id,
          labels: [data.report.category ?? 'bug', data.report.severity ?? 'unknown'].filter(Boolean),
        })
        issueKeyByReportId.set(data.report.id, issue.key)
      },
      'report.status_changed': async (e: MushiEventEnvelope) => {
        const data = e.data as { report: { id: string }; newStatus: string }
        const issueKey = issueKeyByReportId.get(data.report.id)
        if (!issueKey) return
        const transition = statusMap[data.newStatus]
        if (!transition) return
        await jira.transitionIssue(issueKey, transition)
      },
      'fix.applied': async (e: MushiEventEnvelope) => {
        const data = e.data as { report: { id: string }; fix: { pullRequestUrl?: string; summary?: string } }
        const issueKey = issueKeyByReportId.get(data.report.id)
        if (!issueKey) return
        const body = data.fix.pullRequestUrl
          ? `Mushi fix applied: ${data.fix.pullRequestUrl}\n\n${data.fix.summary ?? ''}`
          : `Mushi fix applied: ${data.fix.summary ?? '(no summary)'}`
        await jira.addComment(issueKey, body)
      },
    },
  })
}
