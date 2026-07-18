import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'
import { attachTraceparent } from './trace.ts'
import { linearGql } from './linear.ts'

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
  /** Optional W3C traceparent to propagate into BYOK API calls so the
   *  issue creation shows up in the same distributed trace. */
  traceparent?: string,
): Promise<ExternalIssue[]> {
  const { data: integrations } = await db
    .from('project_integrations')
    .select('id, integration_type, config')
    .eq('project_id', projectId)
    .eq('is_active', true)

  // Determine which routing providers already have a project_integrations row
  // so we don't create a duplicate when Linear is also in vault-backed settings.
  const existingRoutingTypes = new Set((integrations ?? []).map((i) => i.integration_type))

  // Check for vault-backed Linear settings — add a synthetic "integration" if
  // the user connected via OAuth or API key paste in the console (platform settings)
  // but has no legacy project_integrations row.
  let vaultLinearEnabled = false
  if (!existingRoutingTypes.has('linear')) {
    const { data: ps } = await db
      .from('project_settings')
      .select('linear_access_token_ref, linear_api_key_ref')
      .eq('project_id', projectId)
      .maybeSingle()
    vaultLinearEnabled = !!(ps?.linear_access_token_ref || ps?.linear_api_key_ref)
  }

  const tasks = [
    ...(integrations ?? []).map(async (integration) => {
      const result = await dispatchToProvider(integration.integration_type, integration.config as Record<string, unknown>, report, traceparent, db, projectId)
      if (result) {
        await db.from('project_integrations').update({ last_synced_at: new Date().toISOString() }).eq('id', integration.id)
      }
      return result
    }),
    ...(vaultLinearEnabled ? [dispatchToProvider('linear', {}, report, traceparent, db, projectId)] : []),
  ]

  const settled = await Promise.allSettled(tasks)

  const results: ExternalIssue[] = []
  for (const r of settled) {
    if (r.status === 'fulfilled' && r.value) results.push(r.value)
    else if (r.status === 'rejected') intLog.error('Dispatch failed', { err: String(r.reason) })
  }

  return results
}

/**
 * Looks up all external issue linkages for the given report and calls
 * each system's close/resolve API. Idempotent — already-resolved rows
 * are skipped. Called from reports-dashboard.ts when report status
 * changes to 'resolved' or 'dismissed'.
 */
export async function resolveExternalIssue(
  reportId: string,
  projectId: string,
  db: SupabaseClient,
): Promise<void> {
  const { data: openIssues, error } = await db
    .from('report_external_issues')
    .select('id, system, external_id')
    .eq('report_id', reportId)
    .is('resolved_at', null)

  if (error) {
    intLog.error('resolveExternalIssue: query failed', { reportId, err: String(error) })
    return
  }
  if (!openIssues || openIssues.length === 0) return

  const systems = [...new Set(openIssues.map((r: { system: string }) => r.system))]

  const { data: integrations } = await db
    .from('project_integrations')
    .select('integration_type, config')
    .eq('project_id', projectId)
    .eq('is_active', true)
    .in('integration_type', systems)

  const configBySystem = new Map<string, Record<string, unknown>>()
  for (const intg of integrations ?? []) {
    configBySystem.set(
      intg.integration_type as string,
      intg.config as Record<string, unknown>,
    )
  }

  for (const issue of openIssues) {
    const config = configBySystem.get(issue.system as string)
    if (!config) {
      intLog.warn('resolveExternalIssue: no active integration config', {
        system: issue.system,
        reportId,
      })
      continue
    }
    try {
      intLog.info('resolveExternalIssue: resolving', {
        system: issue.system,
        externalId: issue.external_id,
        reportId,
      })
      await resolveForProvider(
        issue.system as string,
        issue.external_id as string,
        config,
        reportId,
        db,
        projectId,
      )
      await db
        .from('report_external_issues')
        .update({ resolved_at: new Date().toISOString() })
        .eq('id', issue.id)
      intLog.info('resolveExternalIssue: resolved', {
        system: issue.system,
        externalId: issue.external_id,
        reportId,
      })
    } catch (err) {
      intLog.error('resolveExternalIssue: failed', {
        system: issue.system,
        externalId: issue.external_id,
        reportId,
        err: String(err),
      })
    }
  }
}

async function resolveForProvider(
  system: string,
  externalId: string,
  config: Record<string, unknown>,
  reportId: string,
  db: SupabaseClient,
  projectId: string,
): Promise<void> {
  switch (system) {
    case 'jira': return resolveJiraIssue(config, externalId)
    case 'linear': return resolveLinearIssue(db, projectId, config, externalId)
    case 'github': return resolveGitHubIssue(config, externalId)
    case 'pagerduty': return resolvePagerDutyAlert(config, externalId)
    case 'sentry': return resolveSentryIssue(config, externalId, reportId)
    default:
      intLog.warn('resolveExternalIssue: unknown system, skipping', { system })
  }
}

async function resolveJiraIssue(config: Record<string, unknown>, externalId: string): Promise<void> {
  const transitionId = Deno.env.get('JIRA_DONE_TRANSITION_ID') ?? '31'
  const res = await fetch(`${config.baseUrl}/rest/api/2/issue/${externalId}/transitions`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${config.email}:${config.apiToken}`)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ transition: { id: transitionId } }),
  })
  if (!res.ok) throw new Error(`Jira transition failed: ${res.status} ${await res.text()}`)
}

async function resolveLinearIssue(
  db: SupabaseClient,
  projectId: string,
  /** Legacy routing config from project_integrations.config — used as fallback if no vault creds. */
  config: Record<string, unknown>,
  externalId: string,
): Promise<void> {
  // Resolve UUID + team done-state in one round-trip via issueByIdentifier.
  // linearGql() resolves credentials from project_settings (vault-backed OAuth
  // token or API key); falls back to env LINEAR_API_KEY if neither is set.
  // Only if linearGql throws due to missing credentials AND a legacy apiKey
  // exists in the routing config do we fall back to a direct fetch.
  const doLookupAndResolve = async (
    gql: <T>(q: string, v?: Record<string, unknown>) => Promise<T>,
  ) => {
    type LookupData = {
      issueByIdentifier: {
        id: string
        team: { states: { nodes: Array<{ id: string; name: string; type: string }> } }
      } | null
    }
    const lookupData = await gql<LookupData>(
      `query IssueByIdentifier($identifier: String!) {
        issueByIdentifier(identifier: $identifier) {
          id
          team { states { nodes { id name type } } }
        }
      }`,
      { identifier: externalId },
    )
    const issue = lookupData.issueByIdentifier
    // Distinguish "issue genuinely not found" from transport failures — linearGql
    // already throws on non-2xx, so a null here means the identifier doesn't exist.
    if (!issue?.id) throw new Error(`Linear: issue not found for identifier ${externalId}`)

    const states = issue.team?.states?.nodes ?? []
    const doneState = states.find((s) => s.type === 'completed' || s.name.toLowerCase() === 'done')
    if (!doneState) throw new Error(`Linear: no completed state found for team`)

    type UpdateData = { issueUpdate: { success: boolean } }
    const updateData = await gql<UpdateData>(
      `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { success }
      }`,
      { id: issue.id, input: { stateId: doneState.id } },
    )
    if (!updateData.issueUpdate?.success) {
      throw new Error(`Linear: issueUpdate returned success=false for ${externalId}`)
    }
  }

  // Try vault-backed credentials first (project_settings)
  try {
    await doLookupAndResolve((q, v) => linearGql(db, projectId, q, v ?? {}))
    return
  } catch (err) {
    // If there are vault credentials but they fail (e.g. expired token), rethrow.
    // Only fall back to legacy config.apiKey for the "no vault credentials" case.
    const msg = String(err)
    if (!msg.includes('No Linear credentials configured') || !config.apiKey) {
      throw err
    }
  }

  // Legacy fallback: use plaintext apiKey from project_integrations.config
  log.warn('Linear: falling back to legacy project_integrations.config.apiKey', { projectId })
  const headers = {
    Authorization: String(config.apiKey),
    'Content-Type': 'application/json',
  }
  const legacyGql = async <T>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
    })
    if (!res.ok) {
      throw new Error(`Linear API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    }
    const json = await res.json() as { data?: T; errors?: Array<{ message: string }> }
    if (json.errors?.length) {
      throw new Error(`Linear GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`)
    }
    if (!json.data) throw new Error('Linear GraphQL: no data in response')
    return json.data
  }
  await doLookupAndResolve(legacyGql)
}

async function resolveGitHubIssue(config: Record<string, unknown>, externalId: string): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${externalId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state: 'closed' }),
    },
  )
  if (!res.ok) throw new Error(`GitHub close failed: ${res.status} ${await res.text()}`)
}

async function resolvePagerDutyAlert(config: Record<string, unknown>, externalId: string): Promise<void> {
  const res = await fetch('https://events.pagerduty.com/v2/enqueue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      routing_key: config.routingKey,
      event_action: 'resolve',
      dedup_key: externalId,
    }),
  })
  if (!res.ok) throw new Error(`PagerDuty resolve failed: ${res.status} ${await res.text()}`)
}

async function resolveSentryIssue(
  config: Record<string, unknown>,
  _externalId: string,
  reportId: string,
): Promise<void> {
  if (!config.authToken || !config.orgSlug || !config.projectSlug) {
    intLog.warn('resolveExternalIssue: Sentry config missing authToken/orgSlug/projectSlug', { reportId })
    return
  }
  // Match by the tag fingerprint we set on capture (mirrors plugin-sentry resolveIssue).
  const query = encodeURIComponent(`mushi.report_id:${reportId}`)
  const url = `https://sentry.io/api/0/projects/${config.orgSlug}/${config.projectSlug}/issues/?query=${query}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.authToken}`,
    },
    body: JSON.stringify({ status: 'resolved' }),
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`Sentry resolve failed: ${res.status} ${await res.text()}`)
  }
}

async function dispatchToProvider(
  type: string,
  config: Record<string, unknown>,
  report: IntegrationReport,
  traceparent: string | undefined,
  db: SupabaseClient,
  projectId: string,
): Promise<ExternalIssue | null> {
  switch (type) {
    case 'jira': return createJiraIssue(config, report, traceparent)
    case 'linear': return createLinearIssue(db, projectId, config, report, traceparent)
    case 'github': return createGitHubIssue(config, report, traceparent)
    case 'pagerduty': return triggerPagerDuty(config, report, traceparent)
    default: return null
  }
}

async function createJiraIssue(config: Record<string, unknown>, report: IntegrationReport, traceparent?: string): Promise<ExternalIssue> {
  const res = await fetch(`${config.baseUrl}/rest/api/3/issue`, {
    method: 'POST',
    headers: attachTraceparent({
      'Authorization': `Basic ${btoa(`${config.email}:${config.apiToken}`)}`,
      'Content-Type': 'application/json',
    }, traceparent),
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

async function createLinearIssue(
  db: SupabaseClient,
  projectId: string,
  /** Legacy routing config from project_integrations.config — used as fallback. */
  config: Record<string, unknown>,
  report: IntegrationReport,
  traceparent?: string,
): Promise<ExternalIssue> {
  // Resolve teamId: prefer project_settings column over legacy config
  let teamId: string | null = null
  const { data: ps } = await db
    .from('project_settings')
    .select('linear_team_id')
    .eq('project_id', projectId)
    .maybeSingle()
  teamId = ps?.linear_team_id ?? String(config.teamId ?? '')

  const MUTATION = `mutation CreateIssue($input: IssueCreateInput!) {
    issueCreate(input: $input) { success issue { id identifier url } }
  }`
  const variables = {
    input: {
      title: `[Mushi] ${report.summary}`,
      description: report.description.slice(0, 500),
      teamId,
      priority: mapSeverityToLinear(report.severity),
    },
  }

  // Try vault-backed credentials first
  try {
    type CreateData = { issueCreate: { success: boolean; issue: { id: string; identifier: string; url: string } | null } }
    const data = await linearGql<CreateData>(db, projectId, MUTATION, variables)
    const issue = data.issueCreate?.issue
    return { externalId: issue?.identifier ?? '', url: issue?.url ?? '', provider: 'linear' }
  } catch (err) {
    const msg = String(err)
    if (!msg.includes('No Linear credentials configured') || !config.apiKey) throw err
  }

  // Legacy fallback: use plaintext apiKey from project_integrations.config
  log.warn('Linear: falling back to legacy project_integrations.config.apiKey for issue creation', { projectId })
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: attachTraceparent({
      Authorization: String(config.apiKey),
      'Content-Type': 'application/json',
    }, traceparent),
    body: JSON.stringify({ query: MUTATION, variables }),
  })
  const data = await res.json()
  const issue = data.data?.issueCreate?.issue
  return { externalId: issue?.identifier ?? '', url: issue?.url ?? '', provider: 'linear' }
}

async function createGitHubIssue(config: Record<string, unknown>, report: IntegrationReport, traceparent?: string): Promise<ExternalIssue> {
  const res = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/issues`, {
    method: 'POST',
    headers: attachTraceparent({
      'Authorization': `token ${config.token}`,
      'Content-Type': 'application/json',
    }, traceparent),
    body: JSON.stringify({
      title: `[Mushi] ${report.summary}`,
      body: `**Category**: ${report.category}\n**Severity**: ${report.severity}\n**Component**: ${report.component ?? 'unknown'}\n\n${report.description}`,
      labels: ['mushi-report', `severity:${report.severity}`],
    }),
  })
  const data = await res.json()
  return { externalId: String(data.number), url: data.html_url, provider: 'github' }
}

async function triggerPagerDuty(config: Record<string, unknown>, report: IntegrationReport, traceparent?: string): Promise<ExternalIssue | null> {
  if (report.severity !== 'critical') return null

  const res = await fetch('https://events.pagerduty.com/v2/enqueue', {
    method: 'POST',
    headers: attachTraceparent({ 'Content-Type': 'application/json' }, traceparent),
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
