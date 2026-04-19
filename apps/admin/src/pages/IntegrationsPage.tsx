/**
 * FILE: apps/admin/src/pages/IntegrationsPage.tsx
 * PURPOSE: V5.3 §2.18 — one-stop hub for the platform integrations the
 *          LLM pipeline + fix-worker depend on (Sentry, Langfuse, GitHub)
 *          plus the routing destinations (Jira / Linear / GitHub Issues /
 *          PagerDuty). Page-level orchestration only — data loading, draft
 *          state, and the network handlers. The cards themselves live in
 *          components/integrations/* so each provider can evolve in isolation.
 */

import { useCallback, useMemo, useState } from 'react'
import { apiFetch } from '../lib/supabase'
import { PageHeader, PageHelp, Loading, ErrorAlert } from '../components/ui'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import { SetupNudge } from '../components/SetupNudge'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { PlatformIntegrationCard } from '../components/integrations/PlatformIntegrationCard'
import { RoutingProviderCard } from '../components/integrations/RoutingProviderCard'
import {
  PLATFORM_DEFS,
  ROUTING_PROVIDERS,
  type HealthRow,
  type Kind,
  type PlatformResponse,
  type RoutingIntegration,
  type RoutingProviderDef,
} from '../components/integrations/types'

export function IntegrationsPage() {
  const toast = useToast()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
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
  const [drafts, setDrafts] = useState<Record<Kind, Record<string, string>>>({
    sentry: {},
    langfuse: {},
    github: {},
  })
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
    setDrafts((d) => ({
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
    const existing = routing.find((r) => r.integration_type === provider.type)
    const current = (existing?.config ?? {}) as Record<string, unknown>
    setRoutingDrafts((d) => ({
      ...d,
      [provider.type]: Object.fromEntries(
        provider.fields.map((f) => [f.name, current[f.name] == null ? '' : String(current[f.name])]),
      ),
    }))
  }

  const cancelRoutingEdit = () => setRoutingEditing(null)

  const saveRouting = async (provider: RoutingProviderDef) => {
    const draft = routingDrafts[provider.type] ?? {}
    const missing = provider.fields.filter((f) => f.required && !(draft[f.name] ?? '').trim())
    if (missing.length) {
      toast.error('Missing required fields', missing.map((f) => f.label).join(', '))
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
    const existing = routing.find((r) => r.integration_type === provider.type)
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

      {!setup.hasAnyProject && (
        <SetupNudge
          requires={['project_created']}
          emptyTitle="Create a project before wiring integrations"
          emptyDescription="Integrations are scoped to a project. Once you have one, you can wire Sentry, Langfuse, GitHub, and your routing destinations."
        />
      )}

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
          {PLATFORM_DEFS.map((def) => (
            <PlatformIntegrationCard
              key={def.kind}
              def={def}
              config={platform?.[def.kind] ?? {}}
              latestProbe={latestByKind[def.kind]}
              sparkline={sparklineByKind[def.kind] ?? []}
              isEditing={editing === def.kind}
              draft={drafts[def.kind] ?? {}}
              saving={saving === def.kind}
              testing={testing === def.kind}
              onStartEdit={() => startEdit(def.kind)}
              onCancelEdit={cancelEdit}
              onChangeField={(name, value) =>
                setDrafts((d) => ({ ...d, [def.kind]: { ...d[def.kind], [name]: value } }))
              }
              onSave={() => void saveKind(def.kind)}
              onTest={() => void testKind(def.kind)}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-2xs uppercase tracking-wider text-fg-faint mb-1.5">Routing destinations</h2>
        <p className="text-2xs text-fg-muted mb-2">
          Forward triaged reports to your ticketing or paging system. Each provider has its own
          credentials; severity + category routing lives in Settings → Routing.
        </p>
        <div className="space-y-2">
          {ROUTING_PROVIDERS.map((provider) => {
            const existing = routing.find((r) => r.integration_type === provider.type)
            return (
              <RoutingProviderCard
                key={provider.type}
                provider={provider}
                existing={existing}
                isEditing={routingEditing === provider.type}
                draft={routingDrafts[provider.type] ?? {}}
                saving={routingSaving === provider.type}
                onStartEdit={() => startRoutingEdit(provider)}
                onCancelEdit={cancelRoutingEdit}
                onChangeField={(name, value) =>
                  setRoutingDrafts((d) => ({
                    ...d,
                    [provider.type]: { ...d[provider.type], [name]: value },
                  }))
                }
                onSave={() => void saveRouting(provider)}
                onTogglePause={() => existing && void toggleRoutingActive(provider, !existing.is_active)}
                onDisconnect={() => void deleteRouting(provider)}
              />
            )
          })}
        </div>
      </section>
    </div>
  )
}
