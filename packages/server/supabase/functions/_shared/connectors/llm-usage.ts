/**
 * FILE: packages/server/supabase/functions/_shared/connectors/llm-usage.ts
 * PURPOSE: `llm_usage` (ADR 0017, Plan 020 §6): what the operator's own
 *          OpenAI and Anthropic organizations spent, attributed to apps by
 *          binding — an OpenAI project id or an Anthropic workspace id per
 *          Mushi project. Read-only cost reports; Mushi cannot cap a
 *          provider's spend, so it reports and links to the provider's limit.
 *
 *   OpenAI:    GET /v1/organization/costs?start_time&bucket_width=1d&group_by=project_id
 *              (admin key). amount.value is USD.
 *   Anthropic: GET /v1/organizations/cost_report?starting_at&group_by[]=workspace_id
 *              (admin key, organizations only — not available to individual
 *              accounts). Amounts are decimal strings in cents (USD), per
 *              Anthropic's Usage & Cost API docs (checked 2026-10-02).
 *
 * config: { provider: 'openai' | 'anthropic' }  readCredential: the admin key.
 */

import { fetchJson, statusReason } from './http-util.ts'
import { ConnectorError, notConnected, type ConnectorContext, type RecipeConnector } from './types.ts'

const DAYS = 30

export interface DailyCost { day: string; externalId: string | null; usd: number }

export function parseOpenAiCosts(body: unknown): DailyCost[] {
  const data = (body as { data?: Array<{ start_time?: number; results?: Array<{ amount?: { value?: number }; project_id?: string | null }> }> } | null)?.data ?? []
  return data.flatMap((bucket) => (bucket.results ?? []).map((r) => ({
    day: new Date((bucket.start_time ?? 0) * 1000).toISOString().slice(0, 10),
    externalId: r.project_id ?? null,
    usd: Number(r.amount?.value ?? 0) || 0,
  })))
}

export function parseAnthropicCosts(body: unknown): DailyCost[] {
  const data = (body as { data?: Array<{ starting_at?: string; results?: Array<{ amount?: string; currency?: string; workspace_id?: string | null }> }> } | null)?.data ?? []
  return data.flatMap((bucket) => (bucket.results ?? [])
    .filter((r) => (r.currency ?? 'USD') === 'USD')
    .map((r) => ({ day: String(bucket.starting_at ?? '').slice(0, 10), externalId: r.workspace_id ?? null, usd: (Number(r.amount ?? 0) || 0) / 100 })))
}

function provider(ctx: ConnectorContext): 'openai' | 'anthropic' | null {
  return ctx.config.provider === 'openai' || ctx.config.provider === 'anthropic' ? ctx.config.provider : null
}

async function costs(ctx: ConnectorContext, p: 'openai' | 'anthropic', since: Date) {
  if (p === 'openai') {
    const q = new URLSearchParams({ start_time: String(Math.floor(since.getTime() / 1000)), bucket_width: '1d', limit: String(DAYS + 1) })
    q.append('group_by', 'project_id')
    return fetchJson(ctx, `https://api.openai.com/v1/organization/costs?${q}`, { headers: { Authorization: `Bearer ${ctx.readCredential}` } })
  }
  const q = new URLSearchParams({ starting_at: since.toISOString(), limit: String(Math.min(31, DAYS + 1)) })
  q.append('group_by[]', 'workspace_id')
  return fetchJson(ctx, `https://api.anthropic.com/v1/organizations/cost_report?${q}`, { headers: { 'x-api-key': ctx.readCredential ?? '', 'anthropic-version': '2023-06-01' } })
}

export const llmUsageConnector: RecipeConnector = {
  kind: 'llm_usage',
  title: 'AI provider spend',
  capabilities: ['snapshot', 'drift'],
  requiredScopes: { snapshot: ['an admin or usage-read key for the provider organization'] },
  credentialNote: 'An OpenAI or Anthropic admin key can read every cost of the organization. Mushi only reads the cost report with it; it never makes model calls with it.',
  async probe(ctx) {
    const p = provider(ctx)
    if (!p) return notConnected('Pick the provider: OpenAI or Anthropic.')
    if (!ctx.readCredential) return notConnected(`Add an ${p === 'openai' ? 'OpenAI' : 'Anthropic'} admin key.`)
    const res = await costs(ctx, p, new Date(ctx.now().getTime() - 86400_000))
    if (res.status === 200) return { ok: true, status: 'connected', granted: ['cost report'], missing: [] }
    return { ok: false, status: 'error', granted: [], missing: res.status === 403 ? ['cost report'] : [], reason: statusReason(p === 'openai' ? 'OpenAI' : 'Anthropic', res.status) }
  },
  async snapshot(ctx, bindings) {
    const p = provider(ctx)
    if (!p || !ctx.readCredential) throw new ConnectorError('AI provider spend is not connected.', 'not_connected')
    const since = new Date(ctx.now().getTime() - DAYS * 86400_000)
    const res = await costs(ctx, p, since)
    if (res.status !== 200) throw new ConnectorError(statusReason(p === 'openai' ? 'OpenAI' : 'Anthropic', res.status))
    const rows = p === 'openai' ? parseOpenAiCosts(res.body) : parseAnthropicCosts(res.body)
    const projectOf = new Map(bindings.map((b) => [b.externalId, b.projectId]))
    const perProject = new Map<string, number>()
    let unattributed = 0
    for (const r of rows) {
      const pid = r.externalId ? projectOf.get(r.externalId) : undefined
      if (pid) perProject.set(pid, (perProject.get(pid) ?? 0) + r.usd)
      else unattributed += r.usd
    }
    const total = rows.reduce((n, r) => n + r.usd, 0)
    return {
      observedAt: ctx.now().toISOString(),
      elements: {},
      resources: [],
      facts: {
        provider: p,
        days: DAYS,
        rows,
        perProject: Object.fromEntries([...perProject].map(([k, v]) => [k, Math.round(v * 100) / 100])),
        unattributedUsd: Math.round(unattributed * 100) / 100,
        totalUsd: Math.round(total * 100) / 100,
      },
    }
  },
  detectDrift(_prev, next) {
    const f = next.facts as { provider: string; unattributedUsd: number; totalUsd: number }
    if (f.totalUsd > 0 && f.unattributedUsd / f.totalUsd > 0.25) {
      return [{
        gate: 'radar', ruleId: 'key_shared_across_apps', severity: 'info',
        message: `About $${f.unattributedUsd.toFixed(2)} of ${f.provider} spend in 30 days is not tied to any app. Spend you cannot attribute is spend you cannot cap.`,
        suggestedFix: { kind: 'prompt', text: `Give each app its own ${f.provider === 'openai' ? 'OpenAI project' : 'Anthropic workspace'} and key, then bind each one to its app in Mushi.` },
      }]
    }
    return []
  },
}
