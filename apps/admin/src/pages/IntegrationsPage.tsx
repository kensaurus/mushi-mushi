/**
 * FILE: apps/admin/src/pages/IntegrationsPage.tsx
 * PURPOSE: V5.3 §2.18 — platform integrations (Sentry, Langfuse, GitHub),
 *          routing destinations, and repo/index readiness for the active project.
 */

import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import {
  PageHeader,
  PageHelp,
  Section,
  ErrorAlert,
  StatCard,
  SegmentedControl,
} from '../components/ui'
import { PanelSkeleton } from '../components/skeletons/PanelSkeleton'
import { usePageData } from '../lib/usePageData'
import { useMergedErrors } from '../lib/useMergedErrors'
import { useRealtimeReload } from '../lib/realtime'
import { usePublishPageContext } from '../lib/pageContext'
import { useToast } from '../lib/toast'
import { SetupNudge } from '../components/SetupNudge'
import { HeroPlugIntegration } from '../components/illustrations/HeroIllustrations'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { PlatformIntegrationCard } from '../components/integrations/PlatformIntegrationCard'
import { RoutingProviderCard } from '../components/integrations/RoutingProviderCard'
import { CodebaseIndexCard } from '../components/integrations/CodebaseIndexCard'
import { RepoReadinessStrip } from '../components/integrations/RepoReadinessStrip'
import { IntegrationStatusBanner } from '../components/integrations/IntegrationStatusBanner'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  PLATFORM_DEFS,
  ROUTING_PROVIDERS,
  type HealthRow,
  type Kind,
  type IntegrationStats,
  type PlatformResponse,
  type RoutingIntegration,
  type RoutingProviderDef,
} from '../components/integrations/types'
import { usePageCopy } from '../lib/copy'
import { PageHero } from '../components/PageHero'
import { useNextBestAction } from '../lib/useNextBestAction'

type TabId = 'platform' | 'routing' | 'repo'

const TABS: Array<{ id: TabId; label: string; description: string }> = [
  {
    id: 'platform',
    label: 'Platform',
    description: 'Sentry, Langfuse, and GitHub credentials the LLM pipeline and fix-worker depend on.',
  },
  {
    id: 'routing',
    label: 'Routing',
    description: 'Forward triaged reports to Jira, Linear, GitHub Issues, or PagerDuty.',
  },
  {
    id: 'repo',
    label: 'Repo & index',
    description: 'Codebase indexing for RAG grounding and repo readiness for auto-fix PRs.',
  },
]

function isTabId(v: string | null): v is TabId {
  return TABS.some((t) => t.id === v)
}

export function IntegrationsPage() {
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const param = searchParams.get('tab')
  const activeTab: TabId = isTabId(param) ? param : 'platform'
  const activeMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0]

  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
  const copy = usePageCopy('/integrations/config')

  const platformPath = activeProjectId ? '/v1/admin/integrations/platform' : null
  const historyPath = activeProjectId ? '/v1/admin/health/history' : null
  const routingPath = activeProjectId ? '/v1/admin/integrations' : null
  const statsPath = activeProjectId ? '/v1/admin/integrations/stats' : null

  const platformQuery = usePageData<PlatformResponse>(platformPath, { deps: [activeProjectId] })
  const historyQuery = usePageData<{ history: HealthRow[] }>(historyPath, { deps: [activeProjectId] })
  const routingQuery = usePageData<{ integrations: RoutingIntegration[] }>(routingPath, {
    deps: [activeProjectId],
  })
  const statsQuery = usePageData<IntegrationStats>(statsPath, { deps: [activeProjectId] })

  const platform = platformQuery.data?.platform ?? null
  const history = historyQuery.data?.history ?? []
  const routing = routingQuery.data?.integrations ?? []
  const stats = statsQuery.data ?? {
    platformTotal: 3,
    platformConnected: 0,
    platformHealthy: 0,
    platformDown: 0,
    routingActive: 0,
    routingPaused: 0,
    routingTotal: 0,
    lastProbeAt: null,
  }

  const merged = useMergedErrors([
    { ...platformQuery, label: 'platform integrations' },
    { ...historyQuery, label: 'integration history' },
    { ...routingQuery, label: 'routing rules' },
  ])
  const loading = merged.loading
  const error = merged.error
  const lastFetchedAt = platformQuery.lastFetchedAt
  const isValidating = platformQuery.isValidating || historyQuery.isValidating

  const reloadAll = useCallback(() => {
    platformQuery.reload()
    historyQuery.reload()
    routingQuery.reload()
    statsQuery.reload()
  }, [platformQuery, historyQuery, routingQuery, statsQuery])

  useRealtimeReload(
    ['project_integrations', 'integration_health_history', 'project_settings'],
    reloadAll,
  )

  const setTab = useCallback(
    (tab: TabId) => {
      const next = new URLSearchParams(searchParams)
      if (tab === 'platform') next.delete('tab')
      else next.set('tab', tab)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

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
  const [pendingDeleteRouting, setPendingDeleteRouting] = useState<RoutingProviderDef | null>(null)
  const [deletingRouting, setDeletingRouting] = useState(false)
  const [testingRouting, setTestingRouting] = useState<string | null>(null)

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

  const disconnectedCount = PLATFORM_DEFS.filter((d) => {
    const cfg = platform?.[d.kind]
    if (!cfg) return true
    const requiredOk = d.fields.filter((f) => f.required).every((f) => cfg[f.name] != null)
    return !requiredOk || latestByKind[d.kind]?.status === 'down'
  }).length

  const expiringCount = 0
  const integrationsAction = useNextBestAction({ scope: 'integrations', disconnectedCount, expiringCount })
  const integrationsSeverity: 'ok' | 'warn' | 'crit' | 'neutral' =
    disconnectedCount === PLATFORM_DEFS.length
      ? 'neutral'
      : disconnectedCount > 0
        ? 'warn'
        : 'ok'
  const latestPlatformProbe = history[0] ?? null
  const missingPlatformConfigIds = [
    ...(platform?.github == null ||
    PLATFORM_DEFS.find((d) => d.kind === 'github')
      ?.fields.filter((f) => f.required)
      .every((f) => platform.github[f.name] != null)
      ? []
      : ['integrations.github.repo_url', 'integrations.github.installation_token']),
    ...(platform?.sentry == null ||
    PLATFORM_DEFS.find((d) => d.kind === 'sentry')
      ?.fields.filter((f) => f.required)
      .every((f) => platform.sentry[f.name] != null)
      ? []
      : ['integrations.sentry.auth_token']),
  ].slice(0, 3)

  usePublishPageContext({
    route: '/integrations/config',
    title: `${activeMeta.label} · Integrations`,
    summary: activeMeta.description,
    filters: { tab: activeTab, project_id: activeProjectId ?? undefined },
    criticalCount: disconnectedCount + stats.platformDown,
  })

  const tabOptions = useMemo(
    () => [
      { id: 'platform' as const, label: 'Platform', count: stats.platformConnected },
      { id: 'routing' as const, label: 'Routing', count: stats.routingActive },
      { id: 'repo' as const, label: 'Repo & index' },
    ],
    [stats.platformConnected, stats.routingActive],
  )

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

  const testRoutingKind = async (healthKind: string, label: string) => {
    setTestingRouting(healthKind)
    const res = await apiFetch<{ status: string; latencyMs: number; detail?: string }>(
      `/v1/admin/health/integration/${healthKind}`,
      { method: 'POST' },
    )
    setTestingRouting(null)
    if (!res.ok) {
      toast.error(`Probe failed for ${label}`, res.error?.message)
    } else if (res.data) {
      const probeStatus = res.data.status
      if (probeStatus === 'ok') toast.success(`${label} healthy`, `${res.data.latencyMs}ms`)
      else toast.error(`${label} probe ${probeStatus}`, res.data.detail)
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
    reloadAll()
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
    reloadAll()
  }

  const deleteRouting = (provider: RoutingProviderDef) => {
    setPendingDeleteRouting(provider)
  }

  const confirmDeleteRouting = async () => {
    if (!pendingDeleteRouting) return
    const provider = pendingDeleteRouting
    setDeletingRouting(true)
    const res = await apiFetch(`/v1/admin/integrations/${provider.type}`, { method: 'DELETE' })
    setDeletingRouting(false)
    setPendingDeleteRouting(null)
    if (!res.ok) {
      toast.error(`Failed to disconnect ${provider.label}`, res.error?.message)
      return
    }
    toast.success(`${provider.label} disconnected`)
    reloadAll()
  }

  if (!activeProjectId) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={copy?.title ?? 'Integrations'}
          description={
            copy?.description ??
            'Wire Sentry, Langfuse, GitHub, and routing destinations for the active project.'
          }
        />
        <SetupNudge
          requires={['project']}
          emptyTitle="Select a project"
          emptyDescription="Integrations are scoped to the active project in the header."
          emptyIcon={<HeroPlugIntegration />}
        />
      </div>
    )
  }

  if (loading) return <PanelSkeleton rows={5} label="Loading integrations" />
  if (error) {
    return (
      <ErrorAlert
        message={`Failed to load ${merged.failedLabel ?? 'integrations'}: ${error}`}
        onRetry={merged.retry}
      />
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={copy?.title ?? 'Integrations'}
        description={
          copy?.description ??
          'Wire Sentry, Langfuse, GitHub, and your routing destinations so the loop closes against tools you already trust.'
        }
      />

      {!setup.hasAnyProject && (
        <SetupNudge
          requires={['project_created']}
          emptyTitle="Create a project before wiring integrations"
          emptyDescription="Integrations are scoped to a project. Once you have one, you can wire Sentry, Langfuse, GitHub, and your routing destinations."
          emptyIcon={<HeroPlugIntegration />}
          blockedIcon={<HeroPlugIntegration accent="text-fg-faint" />}
        />
      )}

      <IntegrationStatusBanner
        stats={stats}
        projectName={projectName}
        disconnectedPlatformCount={disconnectedCount}
      />

      <PageHero
        scope="integrations"
        title={copy?.title ?? 'Integrations'}
        kicker="Platform wiring"
        decide={{
          label:
            disconnectedCount === 0
              ? 'All integrations connected'
              : `${disconnectedCount} integration${disconnectedCount === 1 ? '' : 's'} disconnected or failing`,
          metric: `${PLATFORM_DEFS.length - disconnectedCount}/${PLATFORM_DEFS.length} connected`,
          summary:
            disconnectedCount === 0
              ? 'All platform integrations are connected and passing health probes.'
              : `${disconnectedCount} integration${disconnectedCount === 1 ? '' : 's'} need credentials or failed the last probe — the pipeline degrades without them.`,
          severity: integrationsSeverity,
          anchor: 'integrations:decide',
          evidence: {
            kind: 'metric-breakdown',
            items: PLATFORM_DEFS.map((d) => ({
              label: d.label,
              value: latestByKind[d.kind]?.status ?? (platform?.[d.kind] ? 'configured' : 'missing'),
              tone:
                latestByKind[d.kind]?.status === 'ok'
                  ? 'ok'
                  : latestByKind[d.kind]?.status === 'down'
                    ? 'crit'
                    : latestByKind[d.kind]?.status === 'degraded'
                      ? 'warn'
                      : platform?.[d.kind]
                        ? 'neutral'
                        : 'neutral',
            })),
          },
          missingConfigIds: missingPlatformConfigIds,
        }}
        act={integrationsAction}
        actAnchor="integrations:act"
        actEvidence={
          integrationsAction
            ? {
                kind: 'rule-trace',
                why: integrationsAction.reason ?? integrationsAction.title,
                threshold:
                  disconnectedCount > 0
                    ? `${disconnectedCount} integration${disconnectedCount === 1 ? '' : 's'} disconnected`
                    : undefined,
              }
            : undefined
        }
        actMissingConfigIds={missingPlatformConfigIds}
        verify={{
          label: latestPlatformProbe ? `Last probe · ${latestPlatformProbe.kind}` : 'No probes yet',
          detail: latestPlatformProbe
            ? `${latestPlatformProbe.status} · ${new Date(latestPlatformProbe.checked_at).toLocaleString()}`
            : 'Trigger a test on any platform card below',
          to: '/health?fn=integration-probe',
          secondaryTo: '/audit?source=integrations',
          secondaryLabel: 'Audit log',
          anchor: 'integrations:verify',
          evidence: latestPlatformProbe
            ? {
                kind: 'last-event',
                at: latestPlatformProbe.checked_at,
                by: latestPlatformProbe.kind,
                payloadSummary: `probe ${latestPlatformProbe.status}`,
                status:
                  latestPlatformProbe.status === 'ok'
                    ? 'ok'
                    : latestPlatformProbe.status === 'down'
                      ? 'error'
                      : 'warn',
              }
            : undefined,
        }}
      />

      <PageHelp
        title={copy?.help?.title ?? 'About Integrations'}
        whatIsIt={
          copy?.help?.whatIsIt ??
          'Mushi uses your existing observability + code tools instead of replacing them. Wire Sentry for error context, Langfuse for LLM traces, and GitHub for PRs — then add Jira/Linear/PagerDuty to fan out triaged reports.'
        }
        useCases={
          copy?.help?.useCases ?? [
            'Give the LLM Sentry context so it cross-references real production errors when classifying user reports',
            'Let auto-fix attempts open draft PRs against your repo and report CI status back into Mushi',
            'Mirror Langfuse traces onto every report and fix attempt so cost + prompt are auditable',
          ]
        }
        howToUse={
          copy?.help?.howToUse ??
          'For each card, click Edit to add credentials, then Test to probe live. Status pills, latency, and a 7-day sparkline live-update with each probe.'
        }
      />

      <Section title="Integration workspace" freshness={{ at: lastFetchedAt, isValidating }}>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Platform"
            value={`${stats.platformConnected}/${stats.platformTotal}`}
            hint="Required credentials set"
          />
          <StatCard label="Healthy probes" value={stats.platformHealthy} hint="Latest probe status ok" />
          <StatCard
            label="Routing"
            value={stats.routingActive}
            hint={
              stats.routingPaused > 0
                ? `${stats.routingPaused} paused`
                : 'Active destinations'
            }
          />
          <StatCard
            label="Failing"
            value={stats.platformDown}
            hint={stats.platformDown > 0 ? 'Fix credentials or re-test' : 'No down probes'}
          />
        </div>

        <SegmentedControl
          value={activeTab}
          onChange={setTab}
          options={tabOptions}
          ariaLabel="Integration sections"
          className="mb-4"
        />

        <p className="mb-4 text-2xs text-fg-muted">{activeMeta.description}</p>

        {activeTab === 'platform' && (
          <div className="space-y-2" data-dav-anchor="integrations:decide">
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
        )}

        {activeTab === 'routing' && (
          <div className="space-y-2" data-dav-anchor="integrations:act">
            <p className="mb-2 border-l-2 border-brand/30 pl-2 text-2xs leading-snug text-fg-secondary">
              Forward triaged reports to your ticketing or paging system. Severity + category routing
              lives in Settings → Routing.
            </p>
            {routing.length === 0 && (
              <div className="mb-3 flex items-start gap-2 rounded-md border border-info/30 bg-info/5 px-3 py-2">
                <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
                <p className="text-2xs text-fg-muted">
                  {projectName
                    ? `No routing destinations connected for ${projectName} yet — pick a provider below to forward triaged reports.`
                    : 'No routing destinations connected yet — pick a provider below to forward triaged reports.'}
                </p>
              </div>
            )}
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
                  testing={testingRouting === provider.healthKind}
                  latestProbe={latestByKind[provider.healthKind]}
                  sparkline={sparklineByKind[provider.healthKind] ?? []}
                  onStartEdit={() => startRoutingEdit(provider)}
                  onCancelEdit={cancelRoutingEdit}
                  onChangeField={(name, value) =>
                    setRoutingDrafts((d) => ({
                      ...d,
                      [provider.type]: { ...d[provider.type], [name]: value },
                    }))
                  }
                  onSave={() => void saveRouting(provider)}
                  onTest={() => void testRoutingKind(provider.healthKind, provider.label)}
                  onTogglePause={() => existing && void toggleRoutingActive(provider, !existing.is_active)}
                  onDisconnect={() => void deleteRouting(provider)}
                />
              )
            })}
          </div>
        )}

        {activeTab === 'repo' && activeProjectId && (
          <div className="space-y-2" data-dav-anchor="integrations:verify">
            <RepoReadinessStrip
              projectId={activeProjectId}
              platformRepoUrl={
                (platform?.github as { github_repo_url?: string } | undefined)?.github_repo_url
              }
            />
            <CodebaseIndexCard projectId={activeProjectId} />
          </div>
        )}
      </Section>

      {pendingDeleteRouting && (
        <ConfirmDialog
          title={`Disconnect ${pendingDeleteRouting.label}?`}
          body={`Stored credentials for ${pendingDeleteRouting.label} will be wiped. New triages will stop forwarding here until you reconnect; reports already routed remain in the destination tool.`}
          confirmLabel="Disconnect"
          cancelLabel="Keep connected"
          tone="danger"
          loading={deletingRouting}
          onConfirm={() => void confirmDeleteRouting()}
          onCancel={() => {
            if (!deletingRouting) setPendingDeleteRouting(null)
          }}
        />
      )}
    </div>
  )
}
