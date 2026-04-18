/**
 * FILE: apps/admin/src/pages/IntegrationsPage.tsx
 * PURPOSE: V5.3 §2.18 — one-stop hub for the platform integrations the
 *          LLM pipeline + fix-worker depend on (Sentry, Langfuse, GitHub)
 *          plus the routing destinations (Jira / Linear / GitHub Issues /
 *          PagerDuty). Each card shows:
 *            - configured/missing status pill
 *            - last health probe outcome + latency
 *            - 7-day status sparkline from integration_health_history
 *            - "Test" button that runs a live probe and refreshes
 *            - in-place editor with field-level help for credentials
 *
 *          Replaces the old silently-saving form. Now every save returns a
 *          success/error toast, and dangling credentials show a fix-it CTA.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
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

const ROUTING_PROVIDERS = [
  { type: 'jira', label: 'Jira', fields: ['baseUrl', 'email', 'apiToken', 'projectKey'] },
  { type: 'linear', label: 'Linear', fields: ['apiKey', 'teamId'] },
  { type: 'github', label: 'GitHub Issues', fields: ['token', 'owner', 'repo'] },
  { type: 'pagerduty', label: 'PagerDuty', fields: ['routingKey'] },
] as const

const STATUS_TONE: Record<HealthRow['status'], string> = {
  ok: 'bg-ok-subtle text-ok',
  degraded: 'bg-warning-subtle text-warning',
  down: 'bg-danger-subtle text-danger',
  unknown: 'bg-surface-overlay text-fg-muted',
}

const STATUS_LABEL: Record<HealthRow['status'], string> = {
  ok: 'Healthy',
  degraded: 'Degraded',
  down: 'Down',
  unknown: 'Not configured',
}

interface RoutingIntegration {
  id: string
  integration_type: string
  is_active: boolean
  last_synced_at: string | null
}

export function IntegrationsPage() {
  const [platform, setPlatform] = useState<PlatformResponse['platform'] | null>(null)
  const [history, setHistory] = useState<HealthRow[]>([])
  const [routing, setRouting] = useState<RoutingIntegration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [editing, setEditing] = useState<Kind | null>(null)
  const [drafts, setDrafts] = useState<Record<Kind, Record<string, string>>>({ sentry: {}, langfuse: {}, github: {} })
  const [saving, setSaving] = useState<Kind | null>(null)
  const [savedKind, setSavedKind] = useState<Kind | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [testing, setTesting] = useState<Kind | null>(null)

  const loadAll = useCallback(() => {
    setLoading(true)
    setError(false)
    Promise.all([
      apiFetch<PlatformResponse>('/v1/admin/integrations/platform'),
      apiFetch<{ history: HealthRow[] }>('/v1/admin/health/history'),
      apiFetch<{ integrations: RoutingIntegration[] }>('/v1/admin/integrations'),
    ])
      .then(([pl, hi, ri]) => {
        if (pl.ok && pl.data) setPlatform(pl.data.platform)
        else setError(true)
        if (hi.ok && hi.data) setHistory(hi.data.history)
        if (ri.ok && ri.data) setRouting(ri.data.integrations)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

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
    setSaveError(null)
    // Pre-fill the draft with current (masked) values so the user sees what's
    // already set. Masked values get stripped server-side on save, so they
    // act as visual hints rather than placeholders that overwrite real keys.
    const current = platform?.[kind] ?? {}
    setDrafts(d => ({
      ...d,
      [kind]: Object.fromEntries(
        Object.entries(current).map(([k, v]) => [k, v == null ? '' : String(v)]),
      ),
    }))
  }

  const cancelEdit = () => {
    setEditing(null)
    setSaveError(null)
  }

  const saveKind = async (kind: Kind) => {
    setSaving(kind)
    setSaveError(null)
    const body = drafts[kind]
    const res = await apiFetch(`/v1/admin/integrations/platform/${kind}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
    setSaving(null)
    if (!res.ok) {
      const err = (res as { error?: { message?: string; code?: string } }).error
      setSaveError(err?.message ?? err?.code ?? 'Save failed')
      return
    }
    setSavedKind(kind)
    setEditing(null)
    setTimeout(() => setSavedKind(null), 2_500)
    loadAll()
  }

  const testKind = async (kind: Kind) => {
    setTesting(kind)
    const res = await apiFetch<{ status: string; latencyMs: number; detail?: string }>(
      `/v1/admin/health/integration/${kind}`,
      { method: 'POST' },
    )
    setTesting(null)
    if (!res.ok) {
      setSaveError(`Probe failed: ${(res as { error?: { message?: string } }).error?.message ?? 'unknown'}`)
    }
    loadAll()
  }

  if (loading) return <Loading text="Loading integrations…" />
  if (error) return <ErrorAlert message="Failed to load integrations." onRetry={loadAll} />

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

      {saveError && (
        <Card className="p-2 border border-danger/40 bg-danger-subtle/40 text-xs text-danger">
          {saveError}
          <button type="button" className="ml-2 underline" onClick={() => setSaveError(null)}>dismiss</button>
        </Card>
      )}

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
                      <Badge className={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                      {savedKind === def.kind && (
                        <span className="text-2xs text-ok">Saved ✓</span>
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
        <p className="text-2xs text-fg-muted mb-2">Forward triaged reports to your ticketing or paging system. Configure which severities + categories trigger each in Settings → Routing.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {ROUTING_PROVIDERS.map(p => {
            const active = routing.find(i => i.integration_type === p.type)
            return (
              <Card key={p.type} className={`p-3 ${active?.is_active ? 'border-ok/40' : ''}`}>
                <p className="text-sm font-medium text-fg">{p.label}</p>
                <p className="text-2xs text-fg-faint mt-0.5">
                  {active?.is_active ? 'Connected' : 'Not configured'}
                </p>
                {active?.last_synced_at && (
                  <p className="text-2xs text-fg-muted mt-0.5">
                    Last sync <RelativeTime value={active.last_synced_at} />
                  </p>
                )}
              </Card>
            )
          })}
        </div>
        <p className="text-2xs text-fg-faint mt-2">Routing destinations are configured via the legacy POST /v1/admin/integrations endpoint. A first-class UI lands in the next wave.</p>
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
