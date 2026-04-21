import type { JiraTokens } from './oauth.js'

export interface JiraIssueCreate {
  projectKey: string
  summary: string
  description?: string
  issueType?: string
  labels?: string[]
  mushiReportId?: string
}

export interface JiraIssueCreated {
  id: string
  key: string
  self: string
}

/**
 * Minimal Jira REST v3 client. We use the `api.atlassian.com/ex/jira/{cloudId}`
 * proxy form so the same token works across multiple Jira Cloud sites the
 * user may have consented to.
 */
export class JiraClient {
  constructor(private readonly tokens: JiraTokens) {}

  private baseUrl(): string {
    return `https://api.atlassian.com/ex/jira/${this.tokens.cloudId}/rest/api/3`
  }

  async createIssue(input: JiraIssueCreate): Promise<JiraIssueCreated> {
    const body = {
      fields: {
        project: { key: input.projectKey },
        summary: input.summary,
        issuetype: { name: input.issueType ?? 'Bug' },
        labels: ['mushi-mushi', ...(input.labels ?? [])],
        description: input.description ? adf(input.description) : undefined,
      },
      properties: input.mushiReportId
        ? [{ key: 'mushi.reportId', value: { reportId: input.mushiReportId } }]
        : undefined,
    }
    const res = await fetch(`${this.baseUrl()}/issue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.tokens.accessToken}`,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Jira createIssue failed: HTTP ${res.status} ${await res.text()}`)
    return await res.json() as JiraIssueCreated
  }

  async transitionIssue(issueIdOrKey: string, transitionName: string): Promise<void> {
    const transitionsRes = await fetch(`${this.baseUrl()}/issue/${issueIdOrKey}/transitions`, {
      headers: { Authorization: `Bearer ${this.tokens.accessToken}` },
    })
    if (!transitionsRes.ok) throw new Error(`Jira transitions lookup failed: HTTP ${transitionsRes.status}`)
    const { transitions } = await transitionsRes.json() as { transitions: Array<{ id: string; name: string }> }
    const match = transitions.find(t => t.name.toLowerCase() === transitionName.toLowerCase())
    if (!match) throw new Error(`Jira: no transition named "${transitionName}" for ${issueIdOrKey}`)

    const res = await fetch(`${this.baseUrl()}/issue/${issueIdOrKey}/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.tokens.accessToken}` },
      body: JSON.stringify({ transition: { id: match.id } }),
    })
    if (!res.ok) throw new Error(`Jira transition failed: HTTP ${res.status} ${await res.text()}`)
  }

  async addComment(issueIdOrKey: string, body: string): Promise<void> {
    const res = await fetch(`${this.baseUrl()}/issue/${issueIdOrKey}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.tokens.accessToken}` },
      body: JSON.stringify({ body: adf(body) }),
    })
    if (!res.ok) throw new Error(`Jira addComment failed: HTTP ${res.status} ${await res.text()}`)
  }
}

// Atlassian's v3 REST API requires Atlassian Document Format for rich text.
// We stamp a single plain-text paragraph — plenty for auto-generated
// Mushi→Jira content; richer formatting is a user-override concern.
function adf(text: string): Record<string, unknown> {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }
}
