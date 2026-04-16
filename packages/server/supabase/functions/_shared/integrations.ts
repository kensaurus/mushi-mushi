import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'

const intLog = log.child('integrations')

interface IntegrationReport {
  id: string
  summary: string
  description: string
  category: string
  severity: string
  component?: string
}

interface ExternalIssue {
  externalId: string
  url: string
  provider: string
}

export async function createExternalIssue(
  db: SupabaseClient,
  projectId: string,
  report: IntegrationReport,
): Promise<ExternalIssue[]> {
  const { data: integrations } = await db
    .from('project_integrations')
    .select('id, integration_type, config')
    .eq('project_id', projectId)
    .eq('is_active', true)

  const settled = await Promise.allSettled(
    (integrations ?? []).map(async (integration) => {
      const result = await dispatchToProvider(integration.integration_type, integration.config as Record<string, unknown>, report)
      if (result) {
        await db.from('project_integrations').update({ last_synced_at: new Date().toISOString() }).eq('id', integration.id)
      }
      return result
    }),
  )

  const results: ExternalIssue[] = []
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value) results.push(r.value)
    else if (r.status === 'rejected') intLog.error('Dispatch failed', { err: String(r.reason) })
  }

  return results
}

async function dispatchToProvider(
  type: string,
  config: Record<string, unknown>,
  report: IntegrationReport,
): Promise<ExternalIssue | null> {
  switch (type) {
    case 'jira': return createJiraIssue(config, report)
    case 'linear': return createLinearIssue(config, report)
    case 'github': return createGitHubIssue(config, report)
    case 'pagerduty': return triggerPagerDuty(config, report)
    default: return null
  }
}

async function createJiraIssue(config: Record<string, unknown>, report: IntegrationReport): Promise<ExternalIssue> {
  const res = await fetch(`${config.baseUrl}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${config.email}:${config.apiToken}`)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        project: { key: config.projectKey },
        summary: `[Mushi] ${report.summary}`,
        description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: report.description }] }] },
        issuetype: { name: 'Bug' },
        priority: { name: mapSeverityToJira(report.severity) },
      },
    }),
  })
  const data = await res.json()
  return { externalId: data.key, url: `${config.baseUrl}/browse/${data.key}`, provider: 'jira' }
}

async function createLinearIssue(config: Record<string, unknown>, report: IntegrationReport): Promise<ExternalIssue> {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Authorization': String(config.apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `mutation CreateIssue($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }`,
      variables: {
        input: {
          title: `[Mushi] ${report.summary}`,
          description: report.description.slice(0, 500),
          teamId: String(config.teamId),
          priority: mapSeverityToLinear(report.severity),
        },
      },
    }),
  })
  const data = await res.json()
  const issue = data.data?.issueCreate?.issue
  return { externalId: issue?.identifier ?? '', url: issue?.url ?? '', provider: 'linear' }
}

async function createGitHubIssue(config: Record<string, unknown>, report: IntegrationReport): Promise<ExternalIssue> {
  const res = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `[Mushi] ${report.summary}`,
      body: `**Category**: ${report.category}\n**Severity**: ${report.severity}\n**Component**: ${report.component ?? 'unknown'}\n\n${report.description}`,
      labels: ['mushi-report', `severity:${report.severity}`],
    }),
  })
  const data = await res.json()
  return { externalId: String(data.number), url: data.html_url, provider: 'github' }
}

async function triggerPagerDuty(config: Record<string, unknown>, report: IntegrationReport): Promise<ExternalIssue | null> {
  if (report.severity !== 'critical') return null

  const res = await fetch('https://events.pagerduty.com/v2/enqueue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      routing_key: config.routingKey,
      event_action: 'trigger',
      payload: {
        summary: `[Mushi Critical] ${report.summary}`,
        severity: 'critical',
        source: 'mushi-mushi',
        custom_details: { category: report.category, component: report.component, reportId: report.id },
      },
    }),
  })
  const data = await res.json()
  return { externalId: data.dedup_key ?? '', url: '', provider: 'pagerduty' }
}

function mapSeverityToJira(severity: string): string {
  const map: Record<string, string> = { critical: 'Highest', high: 'High', medium: 'Medium', low: 'Low' }
  return map[severity] ?? 'Medium'
}

function mapSeverityToLinear(severity: string): number {
  const map: Record<string, number> = { critical: 1, high: 2, medium: 3, low: 4 }
  return map[severity] ?? 3
}
