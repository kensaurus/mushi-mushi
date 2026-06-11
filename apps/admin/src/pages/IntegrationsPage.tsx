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
import { PageHeader, PageHelp, Section, ErrorAlert } from '../components/ui'
import { PanelSkeleton } from '../components/skeletons/PanelSkeleton'
import { usePageData } from '../lib/usePageData'
import { useMergedErrors } from '../lib/useMergedErrors'
import { useToast } from '../lib/toast'
import { SetupNudge } from '../components/SetupNudge'
import { HeroPlugIntegration } from '../components/illustrations/HeroIllustrations'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { PlatformIntegrationCard } from '../components/integrations/PlatformIntegrationCard'
import { RoutingProviderCard } from '../components/integrations/RoutingProviderCard'
import { CodebaseIndexCard } from '../components/integrations/CodebaseIndexCard'
import { DryRunPanel } from '../components/integrations/DryRunPanel'
import { DeploymentReadinessCard } from '../components/integrations/DeploymentReadinessCard'
import { SlackIntegrationCard } from '../components/integrations/SlackIntegrationCard'
import { NotificationPrefsMatrix } from '../components/integrations/NotificationPrefsMatrix'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  PLATFORM_DEFS,
  ROUTING_PROVIDERS,
  type HealthRow,
  type Kind,
  type PlatformResponse,
  type RoutingIntegration,
  type RoutingProviderDef,
} from '../components/integrations/types'
import { usePageCopy } from '../lib/copy'
import { PageHero } from '../components/PageHero'
import { useNextBestAction } from '../lib/useNextBestAction'

export function IntegrationsPage() {
  const toast = useToast()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const copy = usePageCopy('/integrations')
  const platformQuery = usePageData<PlatformResponse>('/v1/admin/integrations/platform')
  const historyQuery = usePageData<{ history: HealthRow[] }>('/v1/admin/health/history')
  const routingQuery = usePageData<{ integrations: RoutingIntegration[] }>('/v1/admin/integrations')
  const settingsQuery = usePageData<{ slackConfigured?: boolean; slackTeamName?: string | null }>(
    '/v1/admin/settings',
  )

  const platform = platformQuery.data?.platform ?? null
  const history = historyQuery.data?.history ?? []
  const routing = routingQuery.data?.integrations ?? []
  const vercelSlug = (routing.find((r) => r.integration_type === 'vercel')?.config?.project_slug as string | null) ?? null
  // gate on the merged loading + error so a failing routing query
  // can't silently leave the platform card half-rendered (and so the user
  // gets one retry button instead of three).
  const merged = useMergedErrors([
    { ...platformQuery, label: 'platform integrations' },
    { ...historyQuery, label: 'integration history' },
    { ...routingQuery, label: 'routing rules' },
  ])
  const loading = merged.loading
  const error = merged.error

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
    cursor_cloud: {},
    claude_code_agent: {},
  })
  const [saving, setSaving] = useState<Kind | null>(null)
  const [testing, setTesting] = useState<Kind | null>(null)
  const [inlineErrors, setInlineErrors] = useState<Partial<Record<Kind, string>>>({})
  const clearInlineError = (kind: Kind) =>
    setInlineErrors((e) => { const n = { ...e }; delete n[kind]; return n })

  const [routingEditing, setRoutingEditing] = useState<RoutingProviderDef['type'] | null>(null)
  const [routingDrafts, setRoutingDrafts] = useState<Record<string, Record<string, string>>>({})
  const [routingSaving, setRoutingSaving] = useState<RoutingProviderDef['type'] | null>(null)
  const [pendingDeleteRouting, setPendingDeleteRouting] = useState<RoutingProviderDef | null>(null)
  const [deletingRouting, setDeletingRouting] = useState(false)

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

  // Derive integration health for the hero tile.
  const disconnectedCount = PLATFORM_DEFS.filter(
    (d) => !platform?.[d.kind] || latestByKind[d.kind]?.status === 'down',
  ).length
  const expiringCount = 0  // Token expiry not surfaced in the current data model
  const integrationsAction = useNextBestAction({ scope: 'integrations', disconnectedCount, expiringCount })
  const integrationsSeverity: 'ok' | 'warn' | 'crit' | 'neutral' =
    disconnectedCount === PLATFORM_DEFS.length ? 'neutral'
    : disconnectedCount > 0 ? 'warn'
    : 'ok'
  const latestPlatformProbe = history[0] ?? null
  const missingPlatformConfigIds = [
    ...(platform?.github ? [] : ['integrations.github.repo_url', 'integrations.github.installation_token']),
    ...(platform?.sentry ? [] : ['integrations.sentry.auth_token']),
  ].slice(0, 3)

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
      const msg = res.error?.message ?? res.error?.code ?? 'Unknown error'
      toast.error(`Failed to save ${kind}`, msg)
      setInlineErrors((e) => ({ ...e, [kind]: msg }))
      return
    }
    clearInlineError(kind)
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

  const [testingRouting, setTestingRouting] = useState<string | null>(null)

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
    routingQuery.reload()
  }

  if (loading) return <PanelSkeleton rows={5} label="Loading integrations" />
  if (error) return <ErrorAlert message={`Failed to load ${merged.failedLabel ?? 'integrations'}: ${error}`} onRetry={merged.retry} />

  return (
    <div className="space-y-4">
      <PageHeader
        title={copy?.title ?? 'Integrations'}
        description={copy?.description ?? 'Wire Sentry, Langfuse, GitHub, and your routing destinations so the loop closes against tools you already trust.'}
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

      <PageHero
        scope="integrations"
        title={copy?.title ?? 'Integrations'}
        kicker="Platform wiring"
        decide={{
          label: disconnectedCount === 0 ? 'All integrations connected' : `${disconnectedCount} integration${disconnectedCount === 1 ? '' : 's'} disconnected or failing`,
          metric: `${PLATFORM_DEFS.length - disconnectedCount}/${PLATFORM_DEFS.length} connected`,
          summary: disconnectedCount === 0
            ? 'All platform integrations are connected and passing health probes.'
            : `${disconnectedCount} integration${disconnectedCount === 1 ? '' : 's'} need credentials or failed the last probe — the pipeline degrades without them.`,
          severity: integrationsSeverity,
          anchor: 'integrations:decide',
          evidence: {
            kind: 'metric-breakdown',
            items: PLATFORM_DEFS.map(d => ({
              label: d.label,
              value: latestByKind[d.kind]?.status ?? (platform?.[d.kind] ? 'configured' : 'missing'),
              tone: latestByKind[d.kind]?.status === 'ok' ? 'ok'
                : latestByKind[d.kind]?.status === 'down' ? 'crit'
                : latestByKind[d.kind]?.status === 'degraded' ? 'warn'
                : platform?.[d.kind] ? 'neutral'
                : 'neutral',
            })),
          },
          missingConfigIds: missingPlatformConfigIds,
        }}
        act={integrationsAction}
        actAnchor="integrations:act"
        actEvidence={integrationsAction ? {
          kind: 'rule-trace',
          why: integrationsAction.reason ?? integrationsAction.title,
          threshold: disconnectedCount > 0 ? `${disconnectedCount} integration${disconnectedCount === 1 ? '' : 's'} disconnected` : undefined,
        } : undefined}
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
          evidence: latestPlatformProbe ? {
            kind: 'last-event',
            at: latestPlatformProbe.checked_at,
            by: latestPlatformProbe.kind,
            payloadSummary: `probe ${latestPlatformProbe.status}`,
            status: latestPlatformProbe.status === 'ok' ? 'ok'
              : latestPlatformProbe.status === 'down' ? 'error'
              : 'warn',
          } : undefined,
        }}
      />

      <PageHelp
        title={copy?.help?.title ?? 'About Integrations'}
        whatIsIt={copy?.help?.whatIsIt ?? 'Mushi uses your existing observability + code tools instead of replacing them. Wire Sentry for error context, Langfuse for LLM traces, and GitHub for PRs — then add Jira/Linear/PagerDuty to fan out triaged reports.'}
        useCases={copy?.help?.useCases ?? [
          'Give the LLM Sentry context so it cross-references real production errors when classifying user reports',
          'Let auto-fix attempts open draft PRs against your repo and report CI status back into Mushi',
          'Mirror Langfuse traces onto every report and fix attempt so cost + prompt are auditable',
        ]}
        howToUse={copy?.help?.howToUse ?? [
          'Step 1 — GitHub: paste your repo URL (e.g. https://github.com/org/repo) and install the Mushi GitHub App so fix-worker can push draft PRs. No App = fix generated but never pushed.',
          'Step 2 — Second repo: if your project has a frontend + backend (e.g. solo-boss-cloud), go to Repo → + Add repo and set role=backend with path_globs so fixes target the right codebase.',
          'Step 3 — Sandbox: set Sandbox to e2b, modal, or cloudflare in Settings → Autofix. local-noop generates code but skips the PR in production.',
          'Step 4 — Verified identity: in your app call Mushi.identify({ userId, name, email }) and pass a signed JWT if you want the ✓ verified badge on reports.',
          'Step 5 — Sentry: paste your DSN and auth token. Mushi links Sentry issues to reports and surfaces them on the fix PR.',
          'Step 6 — Test each card with the "Test" button — the health sparkline should turn green within a few seconds.',
        ].join('\n')}
      />

      <Section title="Slack notifications">
        <SlackIntegrationCard
          projectId={activeProjectId ?? null}
          slackConfigured={Boolean(settingsQuery.data?.slackConfigured)}
          teamName={settingsQuery.data?.slackTeamName ?? null}
          latestProbe={latestByKind['slack']}
          sparkline={sparklineByKind['slack'] ?? []}
        />
        {activeProjectId && (
          <div className="mt-4 rounded-xl border border-border bg-surface px-5 py-4">
            <h4 className="text-sm font-semibold text-fg mb-1">Notification events</h4>
            <p className="text-xs text-fg-secondary mb-4">Choose which events trigger a Slack (or Discord) message for this project.</p>
            <NotificationPrefsMatrix projectId={activeProjectId} />
          </div>
        )}
      </Section>

      <Section title="Core platform">
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
              inlineError={inlineErrors[def.kind] ?? null}
              onSave={() => void saveKind(def.kind)}
              onTest={() => void testKind(def.kind)}
            />
          ))}
          {activeProjectId && (
            <div data-dav-anchor="integrations:verify">
              <CodebaseIndexCard projectId={activeProjectId} />
              <DryRunPanel projectId={activeProjectId} />
            </div>
          )}
        </div>
      </Section>

      <Section title="Deployment readiness">
        <p className="text-2xs text-fg-secondary mb-2 pl-2 border-l-2 border-brand/30 leading-snug">
          Close the loop between &ldquo;Mushi just dispatched a fix&rdquo; and
          &ldquo;the fix shipped safely&rdquo;. Each item below is a one-click
          deep link into the host platform settings so your branch-protection
          rules, preview deploys, and production gates stay aligned with the
          auto-fix workflow.
        </p>
        <DeploymentReadinessCard
          projectId={activeProjectId ?? null}
          githubAppInstalled={Boolean(platform?.github?.has_credentials)}
          vercelProjectSlug={vercelSlug}
        />
      </Section>

      <Section title="Routing destinations">
        <p className="text-2xs text-fg-secondary mb-2 pl-2 border-l-2 border-brand/30 leading-snug">
          Forward triaged reports to your ticketing or paging system. Each provider has its own
          credentials; severity + category routing lives in Settings → Routing.
        </p>
        <div className="space-y-2" data-dav-anchor="integrations:act">
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
