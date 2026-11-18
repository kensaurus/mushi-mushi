/**
 * FILE: apps/admin/src/pages/IntegrationsPage.tsx
 * PURPOSE: V5.3 §2.18 — one-stop hub for the platform integrations the
 *          LLM pipeline + fix-worker depend on (Sentry, Langfuse, GitHub)
 *          plus alert channels and issue trackers (Linear, Jira, GitHub Issues,
 *          PagerDuty). Page-level orchestration only — data loading, draft
 *          state, and the network handlers. The cards themselves live in
 *          components/integrations/* so each provider can evolve in isolation.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ADMIN_ONLY_HINT } from '../lib/orgPermissions'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { apiFetch } from '../lib/supabase'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { DisclosurePanel, Panel, PanelSectionLabel } from '../components/ui'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PanelSkeleton } from '../components/skeletons/PanelSkeleton'
import { usePageData } from '../lib/usePageData'
import { useMergedErrors } from '../lib/useMergedErrors'
import { useToast } from '../lib/toast'
import { NextStep } from '../components/NextStep'
import { HeroPlugIntegration } from '../components/illustrations/HeroIllustrations'
import { useSetupStatus } from '../lib/useSetupStatus'
import { useDispatchPreflight } from '../lib/useDispatchPreflight'
import { githubAccessFromPreflight } from '../lib/githubAccess'
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
import { refreshNavCounts } from '../lib/useNavCounts'
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
import { CONNECTION_WORD, ConnectionGrid, tileRunStatus, useConnectionTiles } from '../components/integrations/ConnectionGrid'
import { alertChannelGap, type GridToolId } from '../components/integrations/connectionGridModel'
import { integrationToolForHash } from '../lib/integrationAnchors'
import { Drawer } from '../components/Drawer'
import { BrandIcon } from '../components/ui/BrandIcon'
import { STATUS_INK, StatusMark } from '../components/signal/StatusMark'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { IntegrationsProvenanceReadout } from '../components/integrations/IntegrationsProvenanceReadout'
import { usePageCopy } from '../lib/copy'
import { draftFromSaved, platformSaveBody } from '../lib/platformIntegrationForm'
import { readIntegrationOAuthReturn } from '../lib/integrationOAuthReturn'
import { describeApiFailure } from '../lib/humanizeApiError'
import { useScrollToHash } from '../lib/useScrollToHash'
import { PageLoadError } from '../components/PageLoadError'
import { GitHubConnectCard } from '../components/GitHubConnectCard'

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

  // One GitHub status for the tile, the GitHub card and Codebase indexing: a
  // linked repo plus a GitHub App install or token (the preflight's check).
  const preflight = useDispatchPreflight(activeProjectId)
  const githubAccess = githubAccessFromPreflight(preflight)

  /** True when Linear OAuth or API key is configured. */
  const linearConnected = useMemo(() => {
    const lp = platform?.linear as Record<string, string | null | undefined> | undefined
    return Boolean(lp?.linear_workspace_name || lp?.linear_access_token_ref || lp?.linear_api_key_ref)
  }, [platform])

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
      refreshNavCounts()
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

  // Remove key: pending confirmation + in-flight state
  const [pendingRemoveKeyKind, setPendingRemoveKeyKind] = useState<Kind | null>(null)
  const [removingKeyKind, setRemovingKeyKind] = useState<Kind | null>(null)

  const confirmRemoveKey = async () => {
    if (!pendingRemoveKeyKind) return
    const kind = pendingRemoveKeyKind
    setRemovingKeyKind(kind)
    const res = await apiFetch<{ cleared: string[] }>(`/v1/admin/integrations/platform/${kind}/key`, {
      method: 'DELETE',
    })
    setRemovingKeyKind(null)
    setPendingRemoveKeyKind(null)
    if (!res.ok) {
      const t = describeApiFailure(res.error, `Could not remove the ${kindLabel(kind)} key`)
      toast.error(t.title, t.description)
      return
    }
    toast.success(`${kindLabel(kind)} key removed`)
    reloadAll()
    refreshNavCounts()
  }

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
    // project_settings is not in the realtime publication: move the sidebar
    // Integrations badge now, not on the next reload.
    refreshNavCounts()
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

  // The grid is the page; each tool's settings open in a drawer (owner,
  // 2026-11-18). One verdict per tile, from the same rules as its card.
  const tiles = useConnectionTiles({
    platform: platformQuery.data ?? null,
    history,
    slack: {
      configured: settingsQuery.data ? Boolean(settingsQuery.data.slackConfigured) : null,
      canPost: Boolean(settingsQuery.data?.slackCanPost),
      channelId: settingsQuery.data?.slackChannelId ?? null,
    },
    discordConfigured: Boolean(settingsQuery.data?.discordConfigured),
    teamsConfigured: Boolean(settingsQuery.data?.teamsConfigured),
    linearConnected,
    routing,
    github: githubAccess,
  })
  const [openTool, setOpenTool] = useState<GridToolId | null>(null)
  // Alert events switched on (from the matrix's own load): with no channel they go nowhere.
  const [alertEventsOn, setAlertEventsOn] = useState<number | null>(null)
  // One rule for both: the grid's "No alert channel" row and the matrix's disabled toggles.
  const alertChannelConnected = !alertChannelGap(tiles, 1)
  // A check running from a tile's "Check now" or its card's Test button.
  const checkingTool =
    tiles.find((t) => t.checkKind != null && (t.checkKind === testingRouting || t.checkKind === testing))?.id ?? null
  const openTile = openTool ? (tiles.find((t) => t.id === openTool) ?? null) : null
  const location = useLocation()
  const navigate = useNavigate()

  // About forty links still point at the old card anchors
  // (`#platform-card-github`, `#integrations-codebase`, …): open the drawer
  // that holds the card; useScrollToHash then scrolls to it inside the drawer.
  useEffect(() => {
    const tool = integrationToolForHash(location.hash)
    if (tool) setOpenTool(tool)
  }, [location.key, location.hash])

  const closeDrawer = () => {
    // A confirm opened from inside the drawer (remove key, disconnect) is what
    // Esc and the backdrop close; the drawer stays.
    if (document.querySelectorAll('[aria-modal="true"]').length > 1) return
    setOpenTool(null)
    if (integrationToolForHash(location.hash)) navigate({ search: location.search, hash: '' }, { replace: true })
  }

  /** Open a tool ready to set up: its form in edit mode when it has one. */
  const connectTool = (id: GridToolId) => {
    const platformKind = PLATFORM_DEFS.find((d) => d.kind === id && d.kind !== 'github')?.kind
    if (platformKind) startEdit(platformKind)
    const provider = ROUTING_PROVIDERS.find((p) => p.healthKind === id)
    if (provider) startRoutingEdit(provider)
    setOpenTool(id)
  }

  // Banner CTAs and deep links point at a card (#platform-card-sentry);
  // scroll there once the cards exist.
  useScrollToHash(!loading && !error)

  if (loading) return <PanelSkeleton rows={5} label="Loading integrations" />
  if (error) return <PageLoadError error={error} resource={merged.failedLabel ?? 'integrations'} onRetry={merged.retry} />

  /** One platform card (GitHub token, Sentry, Langfuse, Cursor, Claude Code) with the page's handlers. */
  const platformCard = (def: (typeof PLATFORM_DEFS)[number], extra: { dependency?: boolean } = {}) => (
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
      {...(extra.dependency
        ? {
            dependencyOk: githubConnected,
            dependencyLabel: 'GitHub (code repo)',
            dependencyAnchorId: 'platform-card-github',
            onDependencyJump: () => setOpenTool('github'),
          }
        : {})}
      onApplyToAll={organizationId ? () => setPendingApplyKind(def.kind) : undefined}
      applyingToAll={applyingKind === def.kind}
      onRemoveKey={() => setPendingRemoveKeyKind(def.kind)}
      removingKey={removingKeyKind === def.kind}
      canManage={canManage}
    />
  )

  /** Alert channels are owner/admin only on the server; a disabled fieldset locks the card. */
  const channelCard = (card: ReactNode) => (
    <>
      {!canManage && <p className="text-xs text-fg-muted">{ADMIN_ONLY_HINT}</p>}
      <fieldset disabled={!canManage} className="contents">
        {card}
      </fieldset>
    </>
  )

  /** The settings for one tool: its only home on the page. */
  const toolSettings = (id: GridToolId): ReactNode => {
    switch (id) {
      case 'github':
        // GitHub lives here once: Connect GitHub, the token fallback and code
        // indexing (it showed three times down the page before 2026-11-18).
        return (
          <div id="platform-card-github" className="scroll-mt-chrome space-y-3">
            {activeProjectId && (
              <GitHubConnectCard projectId={activeProjectId} returnTo="integrations" access={githubAccess} onConnected={preflight.reload} />
            )}
            {PLATFORM_DEFS.filter((d) => d.group === 'required' && d.kind === 'github').map((def) => (
              // The token form is the advanced path (self-hosted, or no App
              // install allowed). Open when a token is already set, so its
              // health stays visible.
              <details
                key={def.kind}
                id={`platform-card-${def.kind}-token`}
                open={Boolean(sourceByField?.github_installation_token_ref) || editing === def.kind || !activeProjectId}
                className="group"
              >
                <summary className="cursor-pointer select-none py-1 text-2xs text-fg-secondary hover:text-fg">
                  Use a GitHub token instead (self-hosted, or when the GitHub App is not an option)
                </summary>
                {platformCard(def)}
              </details>
            ))}
            {activeProjectId && (
              <div id="integrations-codebase" className="scroll-mt-chrome space-y-3" data-dav-anchor="integrations:verify">
                <CodebaseIndexCard projectId={activeProjectId} canManage={canManage} githubAccess={githubAccess} />
                <DryRunPanel projectId={activeProjectId} />
              </div>
            )}
          </div>
        )
      case 'slack':
        return channelCard(
          <SlackIntegrationCard
            projectId={activeProjectId ?? null}
            slackConfigured={settingsQuery.data ? Boolean(settingsQuery.data.slackConfigured) : null}
            teamName={settingsQuery.data?.slackTeamName ?? null}
            channelId={settingsQuery.data?.slackChannelId ?? null}
            canPost={Boolean(settingsQuery.data?.slackCanPost)}
            latestProbe={latestByKind['slack']}
            sparkline={sparklineByKind['slack'] ?? []}
            onChanged={reloadChannels}
          />,
        )
      case 'discord':
        return channelCard(
          <DiscordIntegrationCard
            projectId={activeProjectId ?? null}
            discordConfigured={Boolean(settingsQuery.data?.discordConfigured)}
            latestProbe={latestByKind['discord']}
            sparkline={sparklineByKind['discord'] ?? []}
            onChanged={reloadChannels}
          />,
        )
      case 'teams':
        return channelCard(
          <TeamsIntegrationCard
            projectId={activeProjectId ?? null}
            teamsConfigured={Boolean(settingsQuery.data?.teamsConfigured)}
            latestProbe={latestByKind['teams']}
            onChanged={reloadChannels}
          />,
        )
      case 'cursor_cloud':
      case 'claude_code_agent':
        return (
          <div id={`platform-card-${id}`} className="scroll-mt-chrome space-y-2">
            <p className="text-2xs leading-snug text-fg-secondary">
              Or fix bugs with the agent in your own editor from{' '}
              <Link to="/mcp" className="text-accent-foreground underline-offset-2 hover:text-accent hover:underline">
                Editor agents
              </Link>
              .
            </p>
            {PLATFORM_DEFS.filter((d) => d.group === 'fix-agent' && d.kind === id).map((def) => (
              <div key={def.kind}>{platformCard(def, { dependency: true })}</div>
            ))}
          </div>
        )
      case 'linear':
        return (
          <LinearIntegrationCard
            projectId={activeProjectId ?? null}
            linearConnected={linearConnected}
            workspaceName={(platform?.linear as Record<string, string | null | undefined> | undefined)?.linear_workspace_name ?? null}
            teamId={(platform?.linear as Record<string, string | null | undefined> | undefined)?.linear_team_id ?? null}
            latestProbe={latestByKind['linear']}
            sparkline={sparklineByKind['linear'] ?? []}
            onReload={reloadAll}
            onTest={() => void testKind('linear')}
            testing={testing === 'linear'}
            canManage={canManage}
          />
        )
      case 'jira':
      case 'github_issues':
      case 'pagerduty':
        return ROUTING_PROVIDERS.filter((p) => p.healthKind === id).map((provider) => {
          const existing = routing.find((r) => r.integration_type === provider.type)
          return (
            <div key={provider.type} id={`integrations-${provider.healthKind}`} className="scroll-mt-chrome" data-dav-anchor="integrations:act">
              <RoutingProviderCard
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
            </div>
          )
        })
      case 'sentry':
        return PLATFORM_DEFS.filter((d) => d.group === 'required' && d.kind !== 'github').map((def) => (
          <div key={def.kind} id={`platform-card-${def.kind}`} className="scroll-mt-chrome">
            {platformCard(def)}
          </div>
        ))
      case 'langfuse':
        return (
          <div className="space-y-2">
            <p className="text-2xs leading-snug text-fg-secondary">Advanced: trace Mushi Mushi&apos;s AI calls in your own Langfuse.</p>
            {PLATFORM_DEFS.filter((d) => d.group === 'advanced').map((def) => (
              <div key={def.kind} id={`platform-card-${def.kind}`} className="scroll-mt-chrome">
                {platformCard(def)}
              </div>
            ))}
          </div>
        )
    }
  }

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-integrations">
      <PageHeaderBar
        title={copy?.title ?? 'Integrations'}

        helpTitle={copy?.help?.title ?? 'About Integrations'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'Mushi Mushi uses your existing observability + code tools instead of replacing them. Wire Sentry for error context, Langfuse for LLM traces, and GitHub for PRs — then add Jira/Linear/PagerDuty to fan out triaged reports.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'Give the LLM Sentry context so it cross-references real production errors when classifying user reports',
            'Let auto-fix attempts open draft PRs against your repo and report CI status back into Mushi Mushi',
            'Mirror Langfuse traces onto every report and fix attempt so cost + prompt are auditable',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ?? [
            'Step 1 — GitHub: press the GitHub tile, paste your repo URL (e.g. https://github.com/org/repo) and install the Mushi Mushi GitHub App so fix-worker can push draft PRs. No App = fix generated but never pushed.',
            'Step 2 — Second repo: if your project has a frontend + backend (e.g. solo-boss-cloud), go to Repo → + Add repo and set role=backend with path_globs so fixes target the right codebase.',
            'Step 3 — Verified identity: in your app call Mushi.identify({ userId, name, email }) and pass a signed JWT if you want the ✓ verified badge on reports.',
            'Step 4 — Sentry: press the Sentry tile, paste your DSN and auth token. Mushi Mushi links Sentry issues to reports and surfaces them on the fix PR.',
            'Step 5 — Test each tool with the "Test" button in its settings — the health sparkline should turn green within a few seconds.',
          ].join('\n')
        }
      />

      {/* Positioning (AGENTS.md): no monitoring stack required. The page leads
          with what a solo builder needs: GitHub, then alerts in Slack or
          Discord, then the fix agent and their editor. Monitoring is an
          optional on-ramp at the end (integrator's walk and the first-time
          user test, 2026-10-28). Each tile opens that tool's settings. */}
      <PagePosture
        slots={[
          {
            id: 'integrations-grid',
            priority: POSTURE_PRIORITY.status,
            show: setup.hasAnyProject,
            children: (
              <div data-dav-anchor="integrations:decide">
                <ConnectionGrid
                  tiles={tiles}
                  onOpen={setOpenTool}
                  onConnect={connectTool}
                  onCheck={(tile) => {
                    if (tile.checkKind) void testRoutingKind(tile.checkKind, tile.label)
                  }}
                  checkingId={checkingTool}
                  alertEventsOn={alertEventsOn}
                  groups={[
                    {
                      id: 'integrations-required',
                      heading: <PanelSectionLabel>Your code</PanelSectionLabel>,
                      lede: <span data-testid="integrations-core-lede">GitHub is the one Mushi Mushi needs: fixes arrive as pull requests on your repo.</span>,
                      tools: ['github'],
                    },
                    {
                      id: 'integrations-alert-channels',
                      heading: <PanelSectionLabel>Alerts</PanelSectionLabel>,
                      lede: 'Where Mushi Mushi tells you about a new bug, a failing test or a merged fix. One channel is enough.',
                      tools: ['slack', 'discord', 'teams'],
                    },
                    {
                      id: 'integrations-fix-agent',
                      heading: <PanelSectionLabel>Fix agent</PanelSectionLabel>,
                      lede: (
                        <>
                          A cloud agent writes the fix and opens the pull request. Or use the agent in your own editor from{' '}
                          <Link to="/mcp" className="text-accent-foreground underline-offset-2 hover:text-accent hover:underline">
                            Editor agents
                          </Link>
                          .
                        </>
                      ),
                      tools: ['cursor_cloud', 'claude_code_agent'],
                    },
                    {
                      id: 'integrations-routing',
                      heading: <PanelSectionLabel>Issue trackers</PanelSectionLabel>,
                      lede: 'Send triaged reports to the tracker or pager your team already uses. Linear also syncs status back.',
                      tools: ['linear', 'jira', 'github_issues', 'pagerduty'],
                    },
                    {
                      id: 'integrations-monitoring',
                      heading: <PanelSectionLabel>Errors you already catch (optional)</PanelSectionLabel>,
                      lede: (
                        <span data-testid="integrations-monitoring-lede">
                          Mushi Mushi works without a monitoring tool. If you already use Sentry, the errors it catches can become bugs here too.
                        </span>
                      ),
                      tools: ['sentry', 'langfuse'],
                    },
                  ]}
                />
              </div>
            ),
          },
        ]}
      />

      {!setup.hasAnyProject && (
        <NextStep
          variant="inline"
          requires={['project_created']}
          emptyTitle="Create a project before wiring integrations"
          emptyDescription="Integrations belong to an app. Once you have one, connect GitHub, your alerts and your issue tracker."
          emptyIcon={<HeroPlugIntegration />}
          blockedIcon={<HeroPlugIntegration accent="text-fg-faint" />}
        />
      )}

      {/* What every alert channel sends: one matrix for all of them, so it stays on the page. */}
      {activeProjectId && setup.hasAnyProject && (
        <Panel>
          <div id="alerts" className="scroll-mt-chrome px-4 py-3">
            <h4 className="mb-1 text-xs font-semibold text-fg-secondary">Alert events</h4>
            <p className="mb-3 text-2xs leading-snug text-fg-secondary">
              Choose which events send an alert to every connected channel for this project.
            </p>
            <NotificationPrefsMatrix
              projectId={activeProjectId}
              channelConnected={alertChannelConnected}
              onEventsOnChange={setAlertEventsOn}
            />
          </div>
        </Panel>
      )}

      {setup.hasAnyProject && (
        <DisclosurePanel title="Deployment readiness">
          <DeploymentReadinessCard
            projectId={activeProjectId ?? null}
            githubAppInstalled={githubConnected}
            vercelProjectSlug={vercelSlug}
            onAnchorJump={(anchor) => setOpenTool(integrationToolForHash(anchor) ?? 'github')}
          />
        </DisclosurePanel>
      )}

      <Drawer
        open={openTile != null}
        onClose={closeDrawer}
        width="lg"
        ariaLabel={openTile ? `${openTile.label} settings` : 'Integration settings'}
        title={
          openTile ? (
            <span className="flex min-w-0 items-center gap-2">
              <BrandIcon brand={openTile.brand} size={16} decorative />
              <h2 className="truncate text-sm font-bold text-fg">{openTile.label}</h2>
              <StatusMark status={tileRunStatus(openTile)} />
              <span className={`text-3xs font-bold tracking-wider uppercase ${STATUS_INK[tileRunStatus(openTile)]}`}>
                {openTile.view.label ?? CONNECTION_WORD[openTile.view.state]}
              </span>
            </span>
          ) : undefined
        }
      >
        <div className="space-y-3 p-4" data-testid={openTile ? `integration-drawer-${openTile.id}` : undefined}>
          {openTile ? toolSettings(openTile.id) : null}
        </div>
      </Drawer>

      {/* Where each credential comes from (project, team or server), at the foot. */}
      {activeProjectId && stats.projectId ? (
        <IntegrationsProvenanceReadout
          stats={stats}
          githubRepoUrl={typeof platform?.github?.github_repo_url === 'string' ? platform.github.github_repo_url : null}
          fetchedAt={statsQuery.lastFetchedAt}
          validating={statsQuery.isValidating}
        />
      ) : null}

      {/* Related links: the page-help row (lib/pageLinks.ts) is the one row. */}

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

      {pendingRemoveKeyKind && (
        <ConfirmDialog
          title={`Remove the ${kindLabel(pendingRemoveKeyKind)} key?`}
          body={`The keys, tokens and webhook secrets this project stores for ${kindLabel(pendingRemoveKeyKind)} are deleted. Other settings on the card stay. If your team or the server also has a ${kindLabel(pendingRemoveKeyKind)} key, the card keeps using that one; otherwise it stops working until you add a key again.`}
          confirmLabel="Remove key"
          cancelLabel="Keep key"
          tone="danger"
          loading={removingKeyKind === pendingRemoveKeyKind}
          onConfirm={() => void confirmRemoveKey()}
          onCancel={() => {
            if (!removingKeyKind) setPendingRemoveKeyKind(null)
          }}
        />
      )}
    </div>
  )
}
