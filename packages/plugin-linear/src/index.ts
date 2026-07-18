// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * Linear plugin for Mushi Mushi.
 *
 * Subscribes to `report.created`, `report.classified`, and
 * `report.status_changed`. Creates a Linear issue on first sight, then
 * updates the issue title/description on classification and transitions
 * the workflow state when the Mushi report status changes.
 */

import {
  createPluginHandler,
  createMushiClient,
  type MushiEventEnvelope,
  type MushiReportClassifiedEvent,
  type MushiReportCreatedEvent,
  type MushiReportStatusChangedEvent,
} from '@mushi-mushi/plugin-sdk'

const LINEAR_GRAPHQL = 'https://api.linear.app/graphql'

export interface LinearPluginConfig {
  /**
   * Linear personal API key (lin_api_…).
   *
   * Optional — falls back to the `LINEAR_API_KEY` environment variable when
   * omitted, so you can rotate the key via env config without redeploying code.
   *
   * If your project is connected via OAuth in the Mushi admin console, the
   * vaulted token is used server-side (by classify-report / fix-worker);
   * this plugin still needs its own Linear credential for the outbound webhook
   * handler path (it runs in your infra, not Mushi's).
   */
  linearApiKey?: string
  teamId: string
  mushiSecret: string
  /** Mushi REST API key with `reports.comment` scope. */
  mushiApiKey: string
  /** Your Mushi project ID (used for back-comments and future features). */
  projectId?: string
  /** Override the Mushi API base URL (for self-hosted or EU region). */
  mushiBaseUrl?: string
  /** Optional state-id mapping (Mushi status → Linear workflow state ID). */
  stateMap?: Record<string, string>
  fetchImpl?: typeof fetch
}

interface IssueCache {
  get(reportId: string): Promise<string | null> | string | null
  set(reportId: string, issueId: string): Promise<void> | void
}

export function createLinearPlugin(cfg: LinearPluginConfig, cache: IssueCache = createInMemoryCache()) {
  const f = cfg.fetchImpl ?? fetch

  /** Resolves the Linear API key: config > LINEAR_API_KEY env var. */
  function getLinearApiKey(): string {
    const key = cfg.linearApiKey ?? (typeof process !== 'undefined' ? process.env.LINEAR_API_KEY : undefined)
    if (!key) {
      throw new Error(
        'Linear API key not configured. ' +
        'Pass `linearApiKey` in config or set the LINEAR_API_KEY environment variable.',
      )
    }
    return key
  }

  async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await f(LINEAR_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: getLinearApiKey() },
      body: JSON.stringify({ query, variables }),
    })
    if (!res.ok) throw new Error(`Linear API ${res.status}: ${await res.text()}`)
    const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> }
    if (json.errors?.length) throw new Error(`Linear: ${json.errors.map((e) => e.message).join('; ')}`)
    return json.data as T
  }

  async function ensureIssue(envelope: MushiEventEnvelope, title: string, description: string): Promise<string> {
    const reportId = (envelope.data as { report?: { id?: string } })?.report?.id ?? envelope.deliveryId
    const cached = await cache.get(reportId)
    if (cached) return cached

    const data = await gql<{ issueCreate: { issue: { id: string } } }>(
      `mutation($teamId: String!, $title: String!, $description: String!) {
         issueCreate(input: { teamId: $teamId, title: $title, description: $description }) {
           issue { id }
         }
       }`,
      { teamId: cfg.teamId, title, description },
    )
    const issueId = data.issueCreate.issue.id
    await cache.set(reportId, issueId)
    return issueId
  }

  return createPluginHandler({
    secret: cfg.mushiSecret,
    on: {
      'report.created': async (e) => {
        const data = e.data as MushiReportCreatedEvent
        await ensureIssue(e, data.report.title ?? `Mushi report ${data.report.id}`, mushiBody(e))
      },
      'report.classified': async (e) => {
        const data = e.data as MushiReportClassifiedEvent
        const issueId = await ensureIssue(e, data.report.title ?? `Mushi report ${data.report.id}`, mushiBody(e))
        await gql(
          `mutation($id: String!, $title: String!, $description: String!) {
             issueUpdate(id: $id, input: { title: $title, description: $description }) { success }
           }`,
          { id: issueId, title: data.report.title ?? data.report.id, description: mushiBody(e) },
        )
      },
      'report.status_changed': async (e) => {
        const data = e.data as MushiReportStatusChangedEvent
        const issueId = await ensureIssue(e, data.report.title ?? `Mushi report ${data.report.id}`, mushiBody(e))
        const stateId = cfg.stateMap?.[data.newStatus]
        if (!stateId) return
        await gql(
          `mutation($id: String!, $stateId: String!) {
             issueUpdate(id: $id, input: { stateId: $stateId }) { success }
           }`,
          { id: issueId, stateId },
        )
      },
    },
    logger: {
      info: (msg, meta) => console.warn(`[mushi-plugin-linear] ${msg}`, meta ?? ''),
      warn: (msg, meta) => console.warn(`[mushi-plugin-linear] ${msg}`, meta ?? ''),
      error: (msg, meta) => console.error(`[mushi-plugin-linear] ${msg}`, meta ?? ''),
    },
  })
}

export function attachMushiBackComment(cfg: { mushiApiKey: string; projectId: string; mushiBaseUrl?: string }) {
  // Convenience helper for plugin authors who want to write back to Mushi
  // (e.g. "Linked to LIN-1234"). Keeps the dependency on createMushiClient
  // optional from the main handler.
  return createMushiClient({ apiKey: cfg.mushiApiKey, projectId: cfg.projectId, baseUrl: cfg.mushiBaseUrl })
}

function mushiBody(e: MushiEventEnvelope): string {
  const lines = [`**Source:** Mushi Mushi`, `**Project:** ${e.projectId}`, `**Report:** ${(e.data as { report?: { id?: string } })?.report?.id ?? '?'}`, ``]
  lines.push('```json')
  lines.push(JSON.stringify(e.data, null, 2))
  lines.push('```')
  return lines.join('\n')
}

function createInMemoryCache(): IssueCache {
  const map = new Map<string, string>()
  return {
    get: (reportId) => map.get(reportId) ?? null,
    set: (reportId, issueId) => { map.set(reportId, issueId) },
  }
}
