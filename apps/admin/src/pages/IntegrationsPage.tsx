/**
 * FILE: apps/admin/src/pages/IntegrationsPage.tsx
 * PURPOSE: V5.3 §2.18 — one-stop hub for the platform integrations the
 *          LLM pipeline + fix-worker depend on (Sentry, Langfuse, GitHub)
 *          plus the routing destinations (Jira / Linear / GitHub Issues /
 *          PagerDuty). Each card shows:
 *            - configured/missing status pill (shared HealthPill)
 *            - last health probe outcome + latency
 *            - 7-day status sparkline from integration_health_history
 *            - "Test" button that runs a live probe and refreshes
 *            - in-place editor with field-level help for credentials
 *
 *          Replaces the old silently-saving form. Now every save returns a
 *          success/error toast, dangling credentials show a fix-it CTA, and
 *          routing destinations have a first-class CRUD editor wired to
 *          POST/DELETE /v1/admin/integrations.
 */

import { useCallback, useMemo, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import {
  PageHeader,
  PageHelp,
  Card,
  Input,
  Btn,
  Loading,
  ErrorAlert,
  Badge,
  RelativeTime,
} from '../components/ui'
import { HealthPill } from '../components/charts'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'

type Kind = 'sentry' | 'langfuse' | 'github'

interface PlatformResponse {
  platform: Record<Kind, Record<string, unknown>>
}

interface HealthRow {
  id: string
  kind: string
  status: 'ok' | 'degraded' | 'down' | 'unknown'
  latency_ms: number | null
  message: string | null
  source: string
  checked_at: string
}

interface PlatformDef {
  kind: Kind
  label: string
  whyItMatters: string
  fields: Array<{
    name: string
    label: string
    placeholder: string
    type?: 'text' | 'password' | 'url'
    help: string
    required?: boolean
  }>
}

const PLATFORM_DEFS: PlatformDef[] = [
  {
    kind: 'sentry',
    label: 'Sentry',
    whyItMatters: 'Pulls Seer root-cause analysis into your reports and lets the LLM cross-reference production errors with user feedback. Wire the webhook to mirror Sentry user feedback into Mushi.',
    fields: [
      { name: 'sentry_org_slug', label: 'Org slug', placeholder: 'my-company', help: 'Your Sentry organization slug — visible in the Sentry URL after sentry.io/organizations/.', required: true },
      { name: 'sentry_project_slug', label: 'Project slug', placeholder: 'web-app', help: 'The specific Sentry project for this codebase.' },
      { name: 'sentry_auth_token_ref', label: 'Auth token', placeholder: 'sntrys_xxx (or vault://id)', type: 'password', help: 'User-level auth token with project:read + event:read scope. Create at sentry.io/settings/account/api/auth-tokens/.', required: true },
      { name: 'sentry_dsn', label: 'DSN (optional)', placeholder: 'https://abc@o0.ingest.sentry.io/0', help: 'DSN for the SDK to send events. Only needed if you want Mushi reports forwarded as Sentry events.' },
      { name: 'sentry_webhook_secret', label: 'Webhook secret', placeholder: 'shared-secret', type: 'password', help: 'HMAC secret. Configure the same value in Sentry → Settings → Webhooks for inbound user-feedback mirroring.' },
    ],
  },
  {
    kind: 'langfuse',
    label: 'Langfuse',
    whyItMatters: 'Every LLM call (Stage 1 classify, Stage 2 vision, fix-worker) emits a trace. Click any trace from a report or fix attempt to see the exact prompt + response + token cost.',
    fields: [
      { name: 'langfuse_host', label: 'Host', placeholder: 'https://cloud.langfuse.com', type: 'url', help: 'Cloud or self-hosted Langfuse base URL (no trailing slash).', required: true },
      { name: 'langfuse_public_key_ref', label: 'Public key', placeholder: 'pk-lf-… (or vault://id)', type: 'password', help: 'Langfuse public key. From Project Settings → API Keys.', required: true },
      { name: 'langfuse_secret_key_ref', label: 'Secret key', placeholder: 'sk-lf-… (or vault://id)', type: 'password', help: 'Langfuse secret key. Pairs with the public key above for HTTP Basic auth.', required: true },
    ],
  },
  {
    kind: 'github',
    label: 'GitHub (code repo)',
    whyItMatters: 'The fix-worker creates draft PRs against this repo. Add a webhook secret to sync CI check-runs back into the Auto-Fix Pipeline so reviewers see green/red without leaving Mushi.',
    fields: [
      { name: 'github_repo_url', label: 'Repo URL', placeholder: 'https://github.com/owner/repo', type: 'url', help: 'Full HTTPS URL to the repo Mushi should patch. SSH URLs are normalized server-side.', required: true },
      { name: 'github_default_branch', label: 'Default branch', placeholder: 'main', help: 'Defaults to "main" if blank. Change for repos that branch from "master" or "develop".' },
      { name: 'github_installation_token_ref', label: 'Installation token', placeholder: 'ghs_… or ghp_… (or vault://id)', type: 'password', help: 'GitHub App installation token (preferred) or fine-grained PAT. Needs Contents:write + Pull requests:write.', required: true },
      { name: 'github_webhook_secret', label: 'Webhook secret', placeholder: 'shared-secret', type: 'password', help: 'HMAC secret. Set the same value in GitHub repo Settings → Webhooks (events: Check runs, Check suites).' },
    ],
  },
]

interface RoutingFieldDef {
  name: string
  label: string
  placeholder: string
  type?: 'text' | 'password' | 'url'
  help: string
  required?: boolean
}

interface RoutingProviderDef {
  type: 'jira' | 'linear' | 'github' | 'pagerduty'
  label: string
  whyItMatters: string
  fields: RoutingFieldDef[]
}

const ROUTING_PROVIDERS: RoutingProviderDef[] = [
  {
    type: 'jira',
    label: 'Jira',
    whyItMatters: 'Triaged reports become Jira tickets in the project of your choice. Severity maps to Jira priority.',
    fields: [
      { name: 'baseUrl', label: 'Base URL', placeholder: 'https://acme.atlassian.net', type: 'url', help: 'Your Atlassian Cloud or Server base URL.', required: true },
      { name: 'email', label: 'User email', placeholder: 'bot@acme.com', help: 'Email of the Jira user owning the API token.', required: true },
      { name: 'apiToken', label: 'API token', placeholder: 'ATATT3xFf...', type: 'password', help: 'Create at id.atlassian.com → Security → API tokens.', required: true },
      { name: 'projectKey', label: 'Project key', placeholder: 'BUG', help: 'Short uppercase code prefixing every issue (e.g. BUG-123).', required: true },
    ],
  },
  {
    type: 'linear',
    label: 'Linear',
    whyItMatters: 'Mirror reports into Linear with proper labels and priorities. Classification metadata maps to Linear labels.',
    fields: [
      { name: 'apiKey', label: 'API key', placeholder: 'lin_api_...', type: 'password', help: 'Personal API key from Linear → Settings → API.', required: true },
      { name: 'teamId', label: 'Team ID', placeholder: 'TEAM-uuid', help: 'UUID of the Linear team that should receive issues.', required: true },
    ],
  },
  {
    type: 'github',
    label: 'GitHub Issues',
    whyItMatters: 'Open GitHub Issues directly in your repo. Different repo than the auto-fix code repo — this is for tracking, not patching.',
    fields: [
      { name: 'token', label: 'Personal access token', placeholder: 'ghp_...', type: 'password', help: 'Fine-grained PAT with Issues:write on the target repo.', required: true },
      { name: 'owner', label: 'Owner', placeholder: 'acme', help: 'Org or user that owns the repo.', required: true },
      { name: 'repo', label: 'Repo', placeholder: 'public-tracker', help: 'Repository name (no owner prefix).', required: true },
    ],
  },
  {
    type: 'pagerduty',
    label: 'PagerDuty',
    whyItMatters: 'Page on-call when severity ≥ critical. Routes through Events API v2.',
    fields: [
      { name: 'routingKey', label: 'Routing key', placeholder: '32-char integration key', type: 'password', help: 'Events API v2 integration key from PagerDuty service.', required: true },
    ],
  },
]

interface RoutingIntegration {
  id: string
  integration_type: string
  config: Record<string, unknown>
  is_active: boolean
  last_synced_at: string | null
}

const platformStatusMap: Record<HealthRow['status'], string | null | undefined> = {
  ok: 'ok',
  degraded: 'degraded',
  down: 'down',
  unknown: undefined,
}

export function IntegrationsPage() {
  const toast = useToast()
  const platformQuery = usePageData<PlatformResponse>('/v1/admin/integrations/platform')
  const historyQuery = usePageData<{ history: HealthRow[] }>('/v1/admin/health/history')
  const routingQuery = usePageData<{ integrations: RoutingIntegration[] }>('/v1/admin/integrations')

  const platform = platformQuery.data?.platform ?? null
  const history = historyQuery.data?.history ?? []
  const routing = routingQuery.data?.integrations ?? []
  const loading = platformQuery.loading || historyQuery.loading || routingQuery.loading
  const error = platformQuery.error

  const reloadAll = useCallback(() => {
    platformQuery.reload()
    historyQuery.reload()
    routingQuery.reload()
  }, [platformQuery, historyQuery, routingQuery])

  const [editing, setEditing] = useState<Kind | null>(null)
  const [drafts, setDrafts] = useState<Record<Kind, Record<string, string>>>({ sentry: {}, langfuse: {}, github: {} })
  const [saving, setSaving] = useState<Kind | null>(null)
  const [testing, setTesting] = useState<Kind | null>(null)

  const [routingEditing, setRoutingEditing] = useState<RoutingProviderDef['type'] | null>(null)
  const [routingDrafts, setRoutingDrafts] = useState<Record<string, Record<string, string>>>({})
  const [routingSaving, setRoutingSaving] = useState<RoutingProviderDef['type'] | null>(null)

  const latestByKind = useMemo(() => {
    const map: Partial<Record<string, HealthRow>> = {}
    for (const h of history) {
      if (!map[h.kind]) map[h.kind] = h
    }
    return map
  }, [history])

  const sparklineByKind = useMemo(() => {
    const map: Partial<Record<string, HealthRow[]>> = {}
    for (const h of history) {
      ;(map[h.kind] ??= []).push(h)
    }
    return map
  }, [history])

  const startEdit = (kind: Kind) => {
    setEditing(kind)
    const current = platform?.[kind] ?? {}
    setDrafts(d => ({
      ...d,
      [kind]: Object.fromEntries(
        Object.entries(current).map(([k, v]) => [k, v == null ? '' : String(v)]),
      ),
    }))
  }

  const cancelEdit = () => setEditing(null)

  const saveKind = async (kind: Kind) => {
    setSaving(kind)
    const body = drafts[kind]
    const res = await apiFetch(`/v1/admin/integrations/platform/${kind}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
    setSaving(null)
    if (!res.ok) {
      toast.error(`Failed to save ${kind}`, res.error?.message ?? res.error?.code)
      return
    }
    toast.success(`Saved ${kind} integration`)
    setEditing(null)
    reloadAll()
  }

  const testKind = async (kind: Kind) => {
    setTesting(kind)
    const res = await apiFetch<{ status: string; latencyMs: number; detail?: string }>(
      `/v1/admin/health/integration/${kind}`,
      { method: 'POST' },
    )
    setTesting(null)
    if (!res.ok) {
      toast.error(`Probe failed for ${kind}`, res.error?.message)
    } else if (res.data) {
      const probeStatus = res.data.status
      if (probeStatus === 'ok') toast.success(`${kind} healthy`, `${res.data.latencyMs}ms`)
      else toast.error(`${kind} probe ${probeStatus}`, res.data.detail)
    }
    reloadAll()
  }

  const startRoutingEdit = (provider: RoutingProviderDef) => {
    setRoutingEditing(provider.type)
    const existing = routing.find(r => r.integration_type === provider.type)
    const current = (existing?.config ?? {}) as Record<string, unknown>
    setRoutingDrafts(d => ({
      ...d,
      [provider.type]: Object.fromEntries(
        provider.fields.map(f => [f.name, current[f.name] == null ? '' : String(current[f.name])]),
      ),
    }))
  }

  const cancelRoutingEdit = () => setRoutingEditing(null)

  const saveRouting = async (provider: RoutingProviderDef) => {
    const draft = routingDrafts[provider.type] ?? {}
    const missing = provider.fields.filter(f => f.required && !(draft[f.name] ?? '').trim())
    if (missing.length) {
      toast.error('Missing required fields', missing.map(f => f.label).join(', '))
      return
    }
    setRoutingSaving(provider.type)
    const res = await apiFetch('/v1/admin/integrations', {
      method: 'POST',
      body: JSON.stringify({ type: provider.type, config: draft, isActive: true }),
    })
    setRoutingSaving(null)
    if (!res.ok) {
      toast.error(`Failed to save ${provider.label}`, res.error?.message)
      return
    }
    toast.success(`${provider.label} routing saved`)
    setRoutingEditing(null)
    routingQuery.reload()
  }

  const toggleRoutingActive = async (provider: RoutingProviderDef, active: boolean) => {
    const existing = routing.find(r => r.integration_type === provider.type)
    if (!existing) return
    const res = await apiFetch('/v1/admin/integrations', {
      method: 'POST',
      body: JSON.stringify({ type: provider.type, config: existing.config, isActive: active }),
    })
    if (!res.ok) {
      toast.error(`Failed to toggle ${provider.label}`, res.error?.message)
      return
    }
    toast.success(`${provider.label} ${active ? 'enabled' : 'paused'}`)
    routingQuery.reload()
  }

  const deleteRouting = async (provider: RoutingProviderDef) => {
    if (!confirm(`Disconnect ${provider.label}? Stored credentials will be wiped.`)) return
    const res = await apiFetch(`/v1/admin/integrations/${provider.type}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error(`Failed to disconnect ${provider.label}`, res.error?.message)
      return
    }
    toast.success(`${provider.label} disconnected`)
    routingQuery.reload()
  }

  if (loading) return <Loading text="Loading integrations…" />
  if (error) return <ErrorAlert message={`Failed to load integrations: ${error}`} onRetry={reloadAll} />

  return (
    <div className="space-y-4">
      <PageHeader title="Integrations" />

      <PageHelp
        title="About Integrations"
        whatIsIt="Mushi uses your existing observability + code tools instead of replacing them. Wire Sentry for error context, Langfuse for LLM traces, and GitHub for PRs — then add Jira/Linear/PagerDuty to fan out triaged reports."
        useCases={[
          'Give the LLM Sentry context so it cross-references real production errors when classifying user reports',
          'Let auto-fix attempts open draft PRs against your repo and report CI status back into Mushi',
          'Mirror Langfuse traces onto every report and fix attempt so cost + prompt are auditable',
        ]}
        howToUse="For each card, click Edit to add credentials, then Test to probe live. Status pills, latency, and a 7-day sparkline live-update with each probe."
      />

      <section>
        <h2 className="text-2xs uppercase tracking-wider text-fg-faint mb-1.5">Core platform</h2>
        <div className="space-y-2">
          {PLATFORM_DEFS.map(def => {
            const cfg = platform?.[def.kind] ?? {}
            const requiredOk = def.fields.filter(f => f.required).every(f => cfg[f.name] != null)
            const latest = latestByKind[def.kind]
            const status: HealthRow['status'] = !requiredOk
              ? 'unknown'
              : (latest?.status ?? 'unknown')
            const spark = sparklineByKind[def.kind] ?? []
            const isEditing = editing === def.kind

            return (
              <Card key={def.kind} className="p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-fg">{def.label}</h3>
                      <HealthPill status={platformStatusMap[status]} />
                      {!requiredOk && (
                        <Badge className="bg-warn/10 text-warn border border-warn/30">Not configured</Badge>
                      )}
                    </div>
                    <p className="text-2xs text-fg-muted mt-0.5">{def.whyItMatters}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {requiredOk && (
                      <Btn variant="ghost" onClick={() => testKind(def.kind)} disabled={testing === def.kind}>
                        {testing === def.kind ? 'Testing…' : 'Test'}
                      </Btn>
                    )}
                    <Btn variant={isEditing ? 'ghost' : 'primary'} onClick={() => isEditing ? cancelEdit() : startEdit(def.kind)}>
                      {isEditing ? 'Cancel' : (requiredOk ? 'Edit' : 'Configure')}
                    </Btn>
                  </div>
                </div>

                {(latest || spark.length > 0) && (
                  <div className="mt-2 flex items-center gap-3 text-2xs text-fg-muted">
                    {latest?.checked_at && (
                      <span>Last probe <RelativeTime value={latest.checked_at} /></span>
                    )}
                    {latest?.latency_ms != null && (
                      <span className="font-mono">{latest.latency_ms}ms</span>
                    )}
                    {latest?.message && (
                      <span className="font-mono truncate" title={latest.message}>{latest.message}</span>
                    )}
                    {spark.length > 1 && (
                      <Sparkline rows={spark.slice(0, 14)} />
                    )}
                  </div>
                )}

                {isEditing && (
                  <div className="mt-3 space-y-2 border-t border-edge-subtle pt-3">
                    {def.fields.map(field => (
                      <div key={field.name}>
                        <label className="block text-2xs text-fg-muted mb-0.5">
                          {field.label}{field.required && <span className="text-danger ml-0.5">*</span>}
                        </label>
                        <Input
                          type={field.type ?? 'text'}
                          placeholder={field.placeholder}
                          value={drafts[def.kind][field.name] ?? ''}
                          onChange={e => setDrafts(d => ({ ...d, [def.kind]: { ...d[def.kind], [field.name]: e.target.value } }))}
                        />
                        <p className="text-2xs text-fg-faint mt-0.5">{field.help}</p>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-1">
                      <Btn onClick={() => saveKind(def.kind)} disabled={saving === def.kind}>
                        {saving === def.kind ? 'Saving…' : 'Save'}
                      </Btn>
                      <Btn variant="ghost" onClick={cancelEdit}>Cancel</Btn>
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      </section>

      <section>
        <h2 className="text-2xs uppercase tracking-wider text-fg-faint mb-1.5">Routing destinations</h2>
        <p className="text-2xs text-fg-muted mb-2">Forward triaged reports to your ticketing or paging system. Each provider has its own credentials; severity + category routing lives in Settings → Routing.</p>
        <div className="space-y-2">
          {ROUTING_PROVIDERS.map(provider => {
            const existing = routing.find(r => r.integration_type === provider.type)
            const isEditing = routingEditing === provider.type
            const draft = routingDrafts[provider.type] ?? {}
            const status: 'ok' | 'unknown' = existing?.is_active ? 'ok' : 'unknown'
            return (
              <Card key={provider.type} className="p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-fg">{provider.label}</h3>
                      <HealthPill status={existing ? platformStatusMap[status] : undefined} />
                      {existing && !existing.is_active && (
                        <Badge className="bg-warn/10 text-warn border border-warn/30">Paused</Badge>
                      )}
                    </div>
                    <p className="text-2xs text-fg-muted mt-0.5">{provider.whyItMatters}</p>
                    {existing?.last_synced_at && (
                      <p className="text-2xs text-fg-faint mt-0.5">
                        Last sync <RelativeTime value={existing.last_synced_at} />
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {existing && (
                      <>
                        <Btn variant="ghost" onClick={() => toggleRoutingActive(provider, !existing.is_active)}>
                          {existing.is_active ? 'Pause' : 'Resume'}
                        </Btn>
                        <Btn variant="ghost" onClick={() => deleteRouting(provider)}>Disconnect</Btn>
                      </>
                    )}
                    <Btn variant={isEditing ? 'ghost' : 'primary'} onClick={() => isEditing ? cancelRoutingEdit() : startRoutingEdit(provider)}>
                      {isEditing ? 'Cancel' : (existing ? 'Edit' : 'Connect')}
                    </Btn>
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-3 space-y-2 border-t border-edge-subtle pt-3">
                    {provider.fields.map(field => (
                      <div key={field.name}>
                        <label className="block text-2xs text-fg-muted mb-0.5">
                          {field.label}{field.required && <span className="text-danger ml-0.5">*</span>}
                        </label>
                        <Input
                          type={field.type ?? 'text'}
                          placeholder={field.placeholder}
                          value={draft[field.name] ?? ''}
                          onChange={e => setRoutingDrafts(d => ({ ...d, [provider.type]: { ...d[provider.type], [field.name]: e.target.value } }))}
                        />
                        <p className="text-2xs text-fg-faint mt-0.5">{field.help}</p>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-1">
                      <Btn onClick={() => saveRouting(provider)} disabled={routingSaving === provider.type}>
                        {routingSaving === provider.type ? 'Saving…' : 'Save'}
                      </Btn>
                      <Btn variant="ghost" onClick={cancelRoutingEdit}>Cancel</Btn>
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function Sparkline({ rows }: { rows: HealthRow[] }) {
  // Tiny inline sparkline — one bar per probe, colored by status. Reverse so
  // oldest is on the left, newest on the right (visual time direction).
  const ordered = [...rows].reverse()
  return (
    <span className="inline-flex items-end gap-px h-3" aria-label="Recent health history">
      {ordered.map(r => {
        const h = r.status === 'ok' ? 'h-3' : r.status === 'degraded' ? 'h-2' : r.status === 'down' ? 'h-3' : 'h-1'
        const bg =
          r.status === 'ok' ? 'bg-ok' :
          r.status === 'degraded' ? 'bg-warning' :
          r.status === 'down' ? 'bg-danger' : 'bg-fg-faint/30'
        return <span key={r.id} className={`w-1 rounded-sm ${h} ${bg}`} title={`${r.status} · ${r.checked_at}`} />
      })}
    </span>
  )
}
