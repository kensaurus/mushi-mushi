/**
 * FILE: apps/admin/src/pages/IntegrationsPage.tsx
 * PURPOSE: V5.3 §2.18 — one-stop hub for the platform integrations the
 *          LLM pipeline + fix-worker depend on (Sentry, Langfuse, GitHub)
 *          plus the routing destinations (Jira / Linear / GitHub Issues /
 *          PagerDuty). Page-level orchestration only — data loading, draft
 *          state, and the network handlers. The cards themselves live in
 *          components/integrations/* so each provider can evolve in isolation.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ADMIN_ONLY_HINT } from '../lib/orgPermissions'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { apiFetch } from '../lib/supabase'
import { ErrorAlert, Panel, PanelSectionLabel } from '../components/ui'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { PanelSkeleton } from '../components/skeletons/PanelSkeleton'
import { usePageData } from '../lib/usePageData'
import { useMergedErrors } from '../lib/useMergedErrors'
import { useToast } from '../lib/toast'
import { NextStep } from '../components/NextStep'
import { HeroPlugIntegration } from '../components/illustrations/HeroIllustrations'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { setActiveProjectIdSnapshot } from '../lib/activeProject'
import { PlatformIntegrationCard } from '../components/integrations/PlatformIntegrationCard'
import { RoutingProviderCard } from '../components/integrations/RoutingProviderCard'
import { CodebaseIndexCard } from '../components/integrations/CodebaseIndexCard'
import { DryRunPanel } from '../components/integrations/DryRunPanel'
import { DeploymentReadinessCard } from '../components/integrations/DeploymentReadinessCard'
import { SlackIntegrationCard } from '../components/integrations/SlackIntegrationCard'
import { DiscordIntegrationCard } from '../components/integrations/DiscordIntegrationCard'
import { TeamsIntegrationCard } from '../components/integrations/TeamsIntegrationCard'
import { LinearIntegrationCard } from '../components/integrations/LinearIntegrationCard'
import { NotificationPrefsMatrix } from '../components/integrations/NotificationPrefsMatrix'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  PLATFORM_DEFS,
  ROUTING_PROVIDERS,
  EMPTY_INTEGRATION_STATS,
  type HealthRow,
  type IntegrationStats,
  type Kind,
  type PlatformResponse,
  type RoutingIntegration,
  type RoutingProviderDef,
} from '../components/integrations/types'
import { IntegrationStatusBanner } from '../components/integrations/IntegrationStatusBanner'
import { IntegrationsProvenanceReadout } from '../components/integrations/IntegrationsProvenanceReadout'
import { IntegrationsPageIntro } from '../components/integrations/IntegrationsPageIntro'
import { isIntegrationsBannerVisible } from '../lib/integrationsExplainer'
import { usePageCopy } from '../lib/copy'
import { draftFromSaved, platformSaveBody } from '../lib/platformIntegrationForm'
import { readIntegrationOAuthReturn } from '../lib/integrationOAuthReturn'
import { describeApiFailure } from '../lib/humanizeApiError'
import { useScrollToHash } from '../lib/useScrollToHash'

export function IntegrationsPage() {
  const toast = useToast()
  const activeProjectId = useActiveProjectId()
  // Sync the resolved project (URL param takes priority via useActiveProjectId) to
  // localStorage so that apiFetch mutation calls in child components send the correct
  // X-Mushi-Project-Id header even when the page is reached directly via URL.
  useEffect(() => {
    if (activeProjectId) setActiveProjectIdSnapshot(activeProjectId)
  }, [activeProjectId])
  // GitHub App, Linear and Slack install round trips land here with result
  // params. Surface them once as a toast, then strip them so a refresh does
  // not repeat it. Slack's result used to be ignored entirely.
  useEffect(() => {
    const result = readIntegrationOAuthReturn(window.location.search)
    if (!result) return
    const { tone, title, description } = result.toast
    if (tone === 'success') toast.success(title, description)
    else toast.error(title, description)
    const params = new URLSearchParams(window.location.search)
    for (const key of result.consumedKeys) params.delete(key)
    const next = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`)
    // Empty deps: runs once on mount to consume the redirect params.
  }, [])
  const setup = useSetupStatus(activeProjectId)
  const copy = usePageCopy('/integrations')
  const platformQuery = usePageData<PlatformResponse>('/v1/admin/integrations/platform')
  const historyQuery = usePageData<{ history: HealthRow[] }>('/v1/admin/health/history')
  const routingQuery = usePageData<{ integrations: RoutingIntegration[] }>('/v1/admin/integrations')
  // /v1/admin/settings returns raw project_settings rows (no slackConfigured
  // computed field). Stats endpoint derives webhook/channel/bot truth.
  const settingsQuery = usePageData<{
    slackConfigured?: boolean
    slackTeamName?: string | null
    slackChannelId?: string | null
    slackCanPost?: boolean
    discordConfigured?: boolean
    teamsConfigured?: boolean
  }>('/v1/admin/settings/stats')
  const statsQuery = usePageData<IntegrationStats>('/v1/admin/integrations/stats')
  const stats = statsQuery.data ?? EMPTY_INTEGRATION_STATS

  const platform = platformQuery.data?.platform ?? null
  /** Flat map: field name → where the effective value came from ('project'|'org'|'env'|null) */
  const sourceByField = platformQuery.data?.sourceByField ?? {}
  const organizationId = platformQuery.data?.organizationId ?? null
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
    statsQuery.reload()
    settingsQuery.reload()
  }, [platformQuery, historyQuery, routingQuery, statsQuery, settingsQuery])
  // Channel cards (Slack / Discord / Teams) read their state from the settings
  // stats; re-read them after a save so the status line is never stale.
  const reloadChannels = useCallback(() => {
    settingsQuery.reload()
    statsQuery.reload()
  }, [settingsQuery, statsQuery])
  // Credential writes are owner/admin only on the server. Older APIs without
  // the flag keep the controls enabled; the server still refuses.
  const canManage = platformQuery.data?.canManage !== false
  const kindLabel = (kind: Kind) => PLATFORM_DEFS.find((d) => d.kind === kind)?.label ?? kind

  /** True when GitHub is effectively configured (project, org, or env-backed). */
  const githubConnected = useMemo(() => {
    const githubDef = PLATFORM_DEFS.find((d) => d.kind === 'github')
    if (!githubDef) return false
    return githubDef.fields
      .filter((f) => f.required)
      .every((f) => {
        if (platform?.github?.[f.name] != null) return true
        const src = sourceByField[f.name]
        return src === 'org' || src === 'env'
      })
  }, [platform, sourceByField])

  /** True when Linear OAuth or API key is configured. */
  const linearConnected = useMemo(() => {
    const lp = platform?.linear as Record<string, string | null | undefined> | undefined
    return Boolean(lp?.linear_workspace_name || lp?.linear_access_token_ref || lp?.linear_api_key_ref)
  }, [platform])

  const platformConnected = useCallback(
    (kind: Kind) => {
      const def = PLATFORM_DEFS.find((d) => d.kind === kind)
      if (!def) return false
      return def.fields
        .filter((f) => f.required)
        .every((f) => {
          if (platform?.[kind]?.[f.name] != null) return true
          const src = sourceByField[f.name]
          return src === 'org' || src === 'env'
        })
    },
    [platform, sourceByField],
  )

  const integrationIntroFlags = useMemo(
    () => ({
      githubOk: githubConnected,
      sentryOk: platformConnected('sentry'),
      langfuseOk: platformConnected('langfuse'),
      slackOk: Boolean(settingsQuery.data?.slackConfigured),
    }),
    [githubConnected, platformConnected, settingsQuery.data?.slackConfigured],
  )

  const confirmApplyToAll = async () => {
    if (!pendingApplyKind) return
    const kind = pendingApplyKind
    setPendingApplyKind(null)
    setApplyingKind(kind)
    const res = await apiFetch(`/v1/admin/integrations/platform/${kind}/apply`, {
      method: 'POST',
      body: JSON.stringify({ target: 'org-all' }),
    })
    setApplyingKind(null)
    if (!res.ok) {
      const t = describeApiFailure(res.error, `Could not copy ${kindLabel(kind)} to all projects`)
      toast.error(t.title, t.description)
    } else {
      const data = res.data as { applied?: number; skipped?: number; failed?: number; projectNames?: string[] } | null
      const count = data?.applied ?? 0
      const names = data?.projectNames ?? []
      const detail = [
        names.length > 0 ? `Projects: ${names.join(', ')}` : null,
        data?.skipped ? `${data.skipped} skipped (no credentials to copy)` : null,
        data?.failed ? `${data.failed} failed` : null,
      ].filter(Boolean).join(' · ')
      toast.success(
        `Copied to ${count} project${count !== 1 ? 's' : ''}`,
        detail || undefined,
      )
    }
  }

  const [editing, setEditing] = useState<Kind | null>(null)
  const [drafts, setDrafts] = useState<Record<Kind, Record<string, string>>>({
    sentry: {},
    langfuse: {},
    github: {},
    cursor_cloud: {},
    claude_code_agent: {},
    linear: {},
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

  // Bulk-apply: pending confirmation + in-flight state
  const [pendingApplyKind, setPendingApplyKind] = useState<Kind | null>(null)
  const [applyingKind, setApplyingKind] = useState<Kind | null>(null)

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
    setDrafts((d) => ({ ...d, [kind]: draftFromSaved(current) }))
  }

  const cancelEdit = () => setEditing(null)

  const saveKind = async (kind: Kind) => {
    const body = drafts[kind]
    const def = PLATFORM_DEFS.find((d) => d.kind === kind)
    if (def) {
      // A required field only needs to be filled if there is no existing coverage
      // (project draft, org default, or env var). If sourceByField shows 'env' or 'org'
      // the resolver will fall back to those values even when the project draft is empty.
      const missing = def.fields.filter((f) => {
        if (!f.required) return false
        const draftEmpty = !(body[f.name] ?? '').trim()
        if (!draftEmpty) return false
        const src = sourceByField[f.name]
        return src !== 'env' && src !== 'org'
      })
      if (missing.length > 0) {
        const msg = `Required: ${missing.map((f) => f.label).join(', ')}`
        setInlineErrors((e) => ({ ...e, [kind]: msg }))
        return
      }
    }
    const payload = def ? platformSaveBody(def, body, platform?.[kind] ?? {}) : body
    if (Object.keys(payload).length === 0) {
      clearInlineError(kind)
      toast.success(`No changes to save for ${kindLabel(kind)}`)
      setEditing(null)
      return
    }
    setSaving(kind)
    const res = await apiFetch(`/v1/admin/integrations/platform/${kind}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
    setSaving(null)
    if (!res.ok) {
      const t = describeApiFailure(res.error, `Could not save ${kindLabel(kind)}`)
      toast.error(t.title, t.description)
      setInlineErrors((e) => ({ ...e, [kind]: t.description }))
      return
    }
    clearInlineError(kind)
    toast.success(`${kindLabel(kind)} saved`)
    setEditing(null)
    reloadAll()
  }

  /** One plain sentence per probe outcome; `unknown` means nothing to test yet. */
  const toastProbeResult = (label: string, data: { status: string; latencyMs: number; detail?: string }) => {
    if (data.status === 'ok') toast.success(`${label} is working`, `Answered in ${data.latencyMs}ms`)
    else if (data.status === 'unknown') toast.info(`${label} not checked`, data.detail || 'Add the missing details on the card, then test again.')
    else toast.error(`${label} is not working`, data.detail || 'Check the credentials on the card, then test again.')
  }

  const testKind = async (kind: Kind) => {
    setTesting(kind)
    const res = await apiFetch<{ status: string; latencyMs: number; detail?: string }>(
      `/v1/admin/health/integration/${kind}`,
      { method: 'POST' },
    )
    setTesting(null)
    const label = kind === 'linear' ? 'Linear' : kindLabel(kind)
    if (!res.ok) {
      const t = describeApiFailure(res.error, `Could not test ${label}`)
      toast.error(t.title, t.description)
    } else if (res.data) {
      toastProbeResult(label, res.data)
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
      const t = describeApiFailure(res.error, `Could not test ${label}`)
      toast.error(t.title, t.description)
    } else if (res.data) {
      toastProbeResult(label, res.data)
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
      const t = describeApiFailure(res.error, `Could not save ${provider.label}`)
      toast.error(t.title, t.description)
      return
    }
    toast.success(`${provider.label} routing saved`)
    setRoutingEditing(null)
    routingQuery.reload()
    statsQuery.reload()
  }

  const toggleRoutingActive = async (provider: RoutingProviderDef, active: boolean) => {
    const existing = routing.find((r) => r.integration_type === provider.type)
    if (!existing) return
    const res = await apiFetch('/v1/admin/integrations', {
      method: 'POST',
      body: JSON.stringify({ type: provider.type, config: existing.config, isActive: active }),
    })
    if (!res.ok) {
      const t = describeApiFailure(res.error, `Could not ${active ? 'resume' : 'pause'} ${provider.label}`)
      toast.error(t.title, t.description)
      return
    }
    toast.success(`${provider.label} ${active ? 'enabled' : 'paused'}`)
    routingQuery.reload()
    statsQuery.reload()
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
      const t = describeApiFailure(res.error, `Could not disconnect ${provider.label}`)
      toast.error(t.title, t.description)
      return
    }
    toast.success(`${provider.label} disconnected`)
    routingQuery.reload()
    statsQuery.reload()
  }

  // Banner CTAs and deep links point at a card (#platform-card-sentry);
  // scroll there once the cards exist.
  useScrollToHash(!loading && !error)

  if (loading) return <PanelSkeleton rows={5} label="Loading integrations" />
  if (error) return <ErrorAlert message={`Failed to load ${merged.failedLabel ?? 'integrations'}: ${error}`} onRetry={merged.retry} />

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-integrations">
      <PageHeaderBar
        title={copy?.title ?? 'Integrations'}

        helpTitle={copy?.help?.title ?? 'About Integrations'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'Mushi uses your existing observability + code tools instead of replacing them. Wire Sentry for error context, Langfuse for LLM traces, and GitHub for PRs — then add Jira/Linear/PagerDuty to fan out triaged reports.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'Give the LLM Sentry context so it cross-references real production errors when classifying user reports',
            'Let auto-fix attempts open draft PRs against your repo and report CI status back into Mushi',
            'Mirror Langfuse traces onto every report and fix attempt so cost + prompt are auditable',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ?? [
            'Step 1 — GitHub: paste your repo URL (e.g. https://github.com/org/repo) and install the Mushi GitHub App so fix-worker can push draft PRs. No App = fix generated but never pushed.',
            'Step 2 — Second repo: if your project has a frontend + backend (e.g. solo-boss-cloud), go to Repo → + Add repo and set role=backend with path_globs so fixes target the right codebase.',
            'Step 3 — Sandbox: set Sandbox to e2b, modal, or cloudflare in Settings → Autofix. local-noop generates code but skips the PR in production.',
            'Step 4 — Verified identity: in your app call Mushi.identify({ userId, name, email }) and pass a signed JWT if you want the ✓ verified badge on reports.',
            'Step 5 — Sentry: paste your DSN and auth token. Mushi links Sentry issues to reports and surfaces them on the fix PR.',
            'Step 6 — Test each card with the "Test" button — the health sparkline should turn green within a few seconds.',
          ].join('\n')
        }
      />

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            show:
              !loading &&
              isIntegrationsBannerVisible(stats.topPriority, stats.hasAnyProject ?? setup.hasAnyProject),
            children: (
              <IntegrationStatusBanner
                stats={stats}
                projectName={stats.projectName ?? null}
                plainBanner={false}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.guide,
            show: Boolean(activeProjectId && stats.projectId),
            children: (
              <IntegrationsProvenanceReadout
                stats={stats}
                githubRepoUrl={
                  typeof platform?.github?.github_repo_url === 'string'
                    ? platform.github.github_repo_url
                    : null
                }
                fetchedAt={statsQuery.lastFetchedAt}
                validating={statsQuery.isValidating}
              />
            ),
          },
        ]}
      />

      <IntegrationsPageIntro topPriority={stats.topPriority} flags={integrationIntroFlags} />

      {!setup.hasAnyProject && (
        <NextStep
          variant="inline"
          requires={['project_created']}
          emptyTitle="Create a project before wiring integrations"
          emptyDescription="Integrations are scoped to a project. Once you have one, you can wire Sentry, Langfuse, GitHub, and your routing destinations."
          emptyIcon={<HeroPlugIntegration />}
          blockedIcon={<HeroPlugIntegration accent="text-fg-faint" />}
        />
      )}

      <PanelSectionLabel>Notification channels</PanelSectionLabel>
      <Panel className="mb-6">
        <p className="px-4 pt-3 pb-2 text-xs text-fg-muted border-b border-panel-border">
          Connect one or more channels to receive real-time alerts when a report is triaged, a QA story fails, or a fix is merged.
        </p>
        {!canManage && (
          <p className="px-4 py-2 text-xs text-fg-muted border-b border-panel-border">{ADMIN_ONLY_HINT}</p>
        )}
        {/* Where alerts go is owner/admin only on the server; a disabled
            fieldset locks every field and button in the three cards. */}
        <fieldset disabled={!canManage} className="contents">
        <div className="grid gap-4 p-4 md:grid-cols-2 2xl:grid-cols-3">
          <SlackIntegrationCard
            projectId={activeProjectId ?? null}
            slackConfigured={Boolean(settingsQuery.data?.slackConfigured)}
            teamName={settingsQuery.data?.slackTeamName ?? null}
            channelId={settingsQuery.data?.slackChannelId ?? null}
            canPost={Boolean(settingsQuery.data?.slackCanPost)}
            latestProbe={latestByKind['slack']}
            sparkline={sparklineByKind['slack'] ?? []}
            onChanged={reloadChannels}
          />
          <DiscordIntegrationCard
            projectId={activeProjectId ?? null}
            discordConfigured={Boolean(settingsQuery.data?.discordConfigured)}
            latestProbe={latestByKind['discord']}
            sparkline={sparklineByKind['discord'] ?? []}
            onChanged={reloadChannels}
          />
          <TeamsIntegrationCard
            projectId={activeProjectId ?? null}
            teamsConfigured={Boolean(settingsQuery.data?.teamsConfigured)}
            latestProbe={latestByKind['teams']}
            onChanged={reloadChannels}
          />
        </div>
        </fieldset>

        {activeProjectId && (
          <div className="border-t border-panel-border px-4 py-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-1">
              Notification events
            </h4>
            <p className="text-2xs text-fg-muted mb-3 leading-snug">
              Choose which events trigger an alert across all connected channels for this project.
            </p>
            <NotificationPrefsMatrix projectId={activeProjectId} />
          </div>
        )}
      </Panel>

      <PanelSectionLabel>Core platform</PanelSectionLabel>
      <Panel className="mb-6 divide-y divide-panel-border" data-dav-anchor="integrations:decide">
          {/* Required sub-group — connect all three */}
          <div className="p-4">
            <p className="text-2xs text-fg-muted mb-2 pl-2 border-l-2 border-brand/30 leading-snug">
              Connect all three to close the full loop: Sentry surfaces error context, Langfuse traces every LLM call, and GitHub lets the fix-worker open draft PRs.
            </p>
            <div className="space-y-2" id="integrations-required">
              {PLATFORM_DEFS.filter((d) => d.group === 'required').map((def) => (
                <div key={def.kind} id={`platform-card-${def.kind}`}>
                  <PlatformIntegrationCard
                    def={def}
                    config={platform?.[def.kind] ?? {}}
                    sourceByField={sourceByField}
                    latestProbe={latestByKind[def.kind]}
                    sparkline={sparklineByKind[def.kind] ?? []}
                    isEditing={editing === def.kind}
                    draft={drafts[def.kind] ?? {}}
                    saving={saving === def.kind}
                    testing={testing === def.kind}
                    onStartEdit={() => startEdit(def.kind)}
                    onCancelEdit={cancelEdit}
                    onChangeField={(name, value) => {
                      setDrafts((d) => ({ ...d, [def.kind]: { ...d[def.kind], [name]: value } }))
                      clearInlineError(def.kind)
                    }}
                    inlineError={inlineErrors[def.kind] ?? null}
                    onSave={() => void saveKind(def.kind)}
                    onTest={() => void testKind(def.kind)}
                    onApplyToAll={organizationId ? () => setPendingApplyKind(def.kind) : undefined}
                    applyingToAll={applyingKind === def.kind}
                    canManage={canManage}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Fix-agent sub-group — pick one */}
          <div className="p-4 border-t border-panel-border">
            <p className="text-2xs text-fg-muted mb-2 pl-2 border-l-2 border-brand/30 leading-snug">
              Pick one AI fix agent. Both can be configured — Mushi will use the one set in Settings → Autofix.
            </p>
            <div className="space-y-2" id="integrations-fix-agent">
              {PLATFORM_DEFS.filter((d) => d.group === 'fix-agent').map((def) => (
                <div key={def.kind} id={`platform-card-${def.kind}`}>
                  <PlatformIntegrationCard
                    def={def}
                    config={platform?.[def.kind] ?? {}}
                    sourceByField={sourceByField}
                    latestProbe={latestByKind[def.kind]}
                    sparkline={sparklineByKind[def.kind] ?? []}
                    isEditing={editing === def.kind}
                    draft={drafts[def.kind] ?? {}}
                    saving={saving === def.kind}
                    testing={testing === def.kind}
                    onStartEdit={() => startEdit(def.kind)}
                    onCancelEdit={cancelEdit}
                    onChangeField={(name, value) => {
                      setDrafts((d) => ({ ...d, [def.kind]: { ...d[def.kind], [name]: value } }))
                      clearInlineError(def.kind)
                    }}
                    inlineError={inlineErrors[def.kind] ?? null}
                    onSave={() => void saveKind(def.kind)}
                    onTest={() => void testKind(def.kind)}
                    dependencyOk={githubConnected}
                    dependencyLabel="GitHub (code repo)"
                    dependencyAnchorId="platform-card-github"
                    onApplyToAll={organizationId ? () => setPendingApplyKind(def.kind) : undefined}
                    applyingToAll={applyingKind === def.kind}
                    canManage={canManage}
                  />
                </div>
              ))}
            </div>
          </div>

          {activeProjectId && (
            <div id="integrations-codebase" className="p-4 border-t border-panel-border scroll-mt-chrome" data-dav-anchor="integrations:verify">
              <CodebaseIndexCard projectId={activeProjectId} canManage={canManage} />
              <DryRunPanel projectId={activeProjectId} />
            </div>
          )}
      </Panel>

      <PanelSectionLabel>Deployment readiness</PanelSectionLabel>
      <Panel className="mb-6">
        <p className="px-4 pt-3 pb-2 text-2xs text-fg-secondary border-b border-panel-border leading-snug">
          Close the loop between &ldquo;Mushi just dispatched a fix&rdquo; and
          &ldquo;the fix shipped safely&rdquo;. Each item below is a one-click
          deep link into the host platform settings so your branch-protection
          rules, preview deploys, and production gates stay aligned with the
          auto-fix workflow.
        </p>
        <div className="p-4">
        <DeploymentReadinessCard
          projectId={activeProjectId ?? null}
          githubAppInstalled={githubConnected}
          vercelProjectSlug={vercelSlug}
        />
        </div>
      </Panel>

      <PanelSectionLabel>Issue trackers</PanelSectionLabel>
      <Panel className="mb-6">
        <p className="px-4 pt-3 pb-2 text-2xs text-fg-secondary border-b border-panel-border leading-snug">
          Connect Linear to auto-create issues from triaged bug reports, sync status back when issues are resolved, and use Mushi as an AI agent directly within Linear.
        </p>
        <div className="p-4">
          <LinearIntegrationCard
            projectId={activeProjectId ?? null}
            linearConnected={linearConnected}
            workspaceName={
              (platform?.linear as Record<string, string | null | undefined> | undefined)
                ?.linear_workspace_name ?? null
            }
            teamId={
              (platform?.linear as Record<string, string | null | undefined> | undefined)
                ?.linear_team_id ?? null
            }
            latestProbe={latestByKind['linear']}
            sparkline={sparklineByKind['linear'] ?? []}
            onReload={reloadAll}
            onTest={() => void testKind('linear')}
            testing={testing === 'linear'}
            canManage={canManage}
          />
        </div>
      </Panel>

      <PanelSectionLabel>Routing destinations</PanelSectionLabel>
      <Panel className="mb-6">
        <p className="px-4 pt-3 pb-2 text-2xs text-fg-secondary border-b border-panel-border leading-snug">
          Forward triaged reports to your ticketing or paging system. Each provider has its own
          credentials; severity + category routing lives in Settings → Routing.
        </p>
        <div id="integrations-routing" className="divide-y divide-panel-border scroll-mt-chrome" data-dav-anchor="integrations:act">
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
                canManage={canManage}
              />
            )
          })}
        </div>
      </Panel>

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

      {pendingApplyKind && (
        <ConfirmDialog
          title={`Apply ${PLATFORM_DEFS.find((d) => d.kind === pendingApplyKind)?.label ?? pendingApplyKind} to all projects?`}
          body={`This will copy the current project-level credentials for ${PLATFORM_DEFS.find((d) => d.kind === pendingApplyKind)?.label ?? pendingApplyKind} to every other project in your organization. Projects that already have credentials configured will not be overwritten. Secrets are re-vaulted — no plain-text values are shared.`}
          confirmLabel="Apply to all projects"
          cancelLabel="Cancel"
          tone="default"
          loading={false}
          onConfirm={() => void confirmApplyToAll()}
          onCancel={() => setPendingApplyKind(null)}
        />
      )}
    </div>
  )
}
