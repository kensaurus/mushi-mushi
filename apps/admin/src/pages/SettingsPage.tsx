/**
 * FILE: apps/admin/src/pages/SettingsPage.tsx
 * PURPOSE: Tabbed shell for project settings. Each tab is a focused panel
 *          (general / BYOK / Firecrawl / health / dev tools), URL-driven via
 *          ?tab=… so deep links and the back-button behave correctly.
 */

import { useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader, PageHelp, Section, SegmentedControl, StatCard, ErrorAlert } from '../components/ui'
import { GeneralPanel } from '../components/settings/GeneralPanel'
import { ByokPanel } from '../components/settings/ByokPanel'
import { FirecrawlPanel } from '../components/settings/FirecrawlPanel'
import { HealthPanel } from '../components/settings/HealthPanel'
import { DevToolsPanel } from '../components/settings/DevToolsPanel'
import { SettingsStatusBanner } from '../components/settings/SettingsStatusBanner'
import {
  EMPTY_SETTINGS_STATS,
  type SettingsStats,
  type SettingsTabId,
} from '../components/settings/types'
import { SetupNudge } from '../components/SetupNudge'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { useSetupStatus } from '../lib/useSetupStatus'
import { usePageCopy } from '../lib/copy'
import { useSettingsUx, resolveQuickSettingsTab } from '../lib/settingsModeUx'
import { usePublishPageContext } from '../lib/pageContext'
import { usePageData } from '../lib/usePageData'
import {
  byokDetail,
  byokTooltip,
  classifierDetail,
  classifierTooltip,
  routingDetail,
  routingTooltip,
  sdkDetail,
  sdkTooltip,
} from '../lib/statTooltips/settings'
import { settingsLinks } from '../lib/statCardLinks'
import { useRealtimeReload } from '../lib/realtime'
import { PanelSkeleton } from '../components/skeletons/PanelSkeleton'

const TABS: Array<{ id: SettingsTabId; label: string; description: string }> = [
  { id: 'general', label: 'General', description: 'Slack webhooks, Sentry DSN, LLM model, dedup threshold.' },
  { id: 'byok', label: 'LLM keys', description: 'Anthropic + OpenAI-compatible BYOK — save, test, rotate.' },
  { id: 'firecrawl', label: 'Firecrawl', description: 'Optional web research provider for triage.' },
  { id: 'health', label: 'Health', description: 'Connection status, SDK reference, pipeline smoke test.' },
  { id: 'dev', label: 'Dev tools', description: 'SDK widget toggles and local-only debug flags.' },
]

const TAB_TITLES: Record<SettingsTabId, string> = {
  general: 'General',
  byok: 'BYOK',
  firecrawl: 'Firecrawl',
  health: 'Health',
  dev: 'Dev tools',
}

function isTabId(value: string | null): value is SettingsTabId {
  return TABS.some((t) => t.id === value)
}

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const copy = usePageCopy('/settings')
  const ux = useSettingsUx()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null

  const param = searchParams.get('tab')
  const active: SettingsTabId = isTabId(param) ? param : 'general'
  const activeMeta = TABS.find((t) => t.id === active) ?? TABS[0]

  const statsPath = activeProjectId ? '/v1/admin/settings/stats' : null
  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt,
    isValidating,
  } = usePageData<SettingsStats>(statsPath)
  const stats = { ...EMPTY_SETTINGS_STATS, ...statsData }

  const reloadAll = useCallback(() => {
    reloadStats()
  }, [reloadStats])

  useRealtimeReload(['project_settings'], reloadAll)

  const setActive = useCallback(
    (id: SettingsTabId) => {
      const next = new URLSearchParams(searchParams)
      if (id === 'general') next.delete('tab')
      else next.set('tab', id)
      setSearchParams(next, { replace: true, preventScrollReset: true })
    },
    [searchParams, setSearchParams],
  )

  useEffect(() => {
    if (!ux.isQuickstart || !activeProjectId || statsLoading) return
    const quickTab = resolveQuickSettingsTab(stats)
    if (active !== quickTab) setActive(quickTab)
  }, [ux.isQuickstart, activeProjectId, statsLoading, stats, active, setActive])

  const criticalCount =
    (stats.byokKeysFailing > 0 ? stats.byokKeysFailing : 0) +
    (!stats.byokAnthropicConfigured ? 1 : 0) +
    (!stats.sdkConfigEnabled ? 1 : 0) +
    stats.byokKeysUntested

  usePublishPageContext({
    route: '/settings',
    title: `${TAB_TITLES[active]} · Settings`,
    summary: activeMeta.description,
    filters: { tab: active, project_id: activeProjectId ?? undefined },
    criticalCount,
  })

  const tabOptions = useMemo(
    () => [
      { id: 'general' as const, label: copy?.tabLabels?.general ?? 'General' },
      {
        id: 'byok' as const,
        label: copy?.tabLabels?.byok ?? 'LLM keys',
        count:
          stats.byokKeysFailing > 0
            ? stats.byokKeysFailing
            : stats.byokKeysUntested > 0
              ? stats.byokKeysUntested
              : undefined,
      },
      { id: 'firecrawl' as const, label: copy?.tabLabels?.firecrawl ?? 'Firecrawl' },
      { id: 'health' as const, label: copy?.tabLabels?.health ?? 'Health' },
      { id: 'dev' as const, label: copy?.tabLabels?.dev ?? 'Dev' },
    ],
    [stats.byokKeysFailing, stats.byokKeysUntested, copy?.tabLabels],
  )

  if (!activeProjectId) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={copy?.title ?? 'Project settings'}
          description={
            copy?.description ??
            'Per-project flags, LLM keys, SDK widget, and developer tools — scoped to the active project.'
          }
        />
        <SetupNudge
          requires={['project']}
          emptyTitle="Select a project"
          emptyDescription="Settings apply to the active project in the header — pick mushi-mushi (or your app) before editing."
        />
      </div>
    )
  }

  if (statsLoading && !statsData) {
    return <PanelSkeleton rows={6} label="Loading settings" />
  }
  if (statsError) {
    return <ErrorAlert message={`Failed to load settings stats: ${statsError}`} onRetry={reloadAll} />
  }

  return (
    <div className="space-y-4" data-testid="mushi-page-settings">
      <PageHelp
        title={copy?.help?.title ?? 'About Settings'}
        whatIsIt={
          copy?.help?.whatIsIt ??
          'Project-level configuration scoped to the header project: BYOK LLM keys, classifier model, dedup threshold, SDK widget, and developer toggles.'
        }
        useCases={
          copy?.help?.useCases ?? [
            'Bring your own Anthropic / OpenAI keys so cost stays on your bill',
            'Run Health → Send test report before wiring production SDK traffic',
            'Tune Stage-2 model and dedup threshold after you see false positives in triage',
          ]
        }
        howToUse={
          copy?.help?.howToUse ??
          'General saves Slack/Sentry + classifier fields. LLM keys tab tests BYOK. Health runs a pipeline smoke test. Changes write to project_settings immediately on Save.'
        }
      />

      <PageHeader
        title={copy?.title ?? 'Project settings'}
        description={
          copy?.description ??
          'Per-project flags, retention, routing defaults, and feature toggles — saved per project.'
        }
        projectScope={projectName ?? stats.projectName}
      />

      <SettingsStatusBanner stats={stats} onTab={setActive} plainBanner={ux.plainBanner} />

      {!ux.hideTabs && (
      <SegmentedControl
        value={active}
        onChange={setActive}
        options={tabOptions}
        ariaLabel="Settings sections"
      />
      )}

      {!ux.hideSettingsSnapshot && (
      <Section title={copy?.sections?.snapshot ?? 'SETTINGS SNAPSHOT'} freshness={{ at: lastFetchedAt, isValidating }}>
        <p className="mb-3 text-2xs text-fg-muted">{activeMeta.description}</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={copy?.statLabels?.byok ?? 'BYOK keys'}
            value={stats.byokKeysConfigured}
            accent={
              stats.byokKeysFailing > 0
                ? 'text-danger'
                : stats.byokKeysPassing > 0
                  ? 'text-ok'
                  : undefined
            }
            tooltip={byokTooltip(stats)}
            detail={byokDetail(stats)}
            to={settingsLinks.byok}
          />
          <StatCard
            label={copy?.statLabels?.sdk ?? 'SDK widget'}
            value={stats.sdkConfigEnabled ? 'On' : 'Off'}
            accent={stats.sdkConfigEnabled ? 'text-ok' : 'text-warn'}
            tooltip={sdkTooltip(stats)}
            detail={sdkDetail(stats)}
            to={settingsLinks.sdk}
          />
          <StatCard
            label={copy?.statLabels?.routing ?? 'Routing'}
            value={[stats.slackConfigured && 'Slack', stats.sentryConfigured && 'Sentry']
              .filter(Boolean)
              .join(' · ') || 'None'}
            accent={stats.slackConfigured || stats.sentryConfigured ? 'text-brand' : undefined}
            tooltip={routingTooltip(stats)}
            detail={routingDetail()}
            to={settingsLinks.routing}
          />
          <StatCard
            label={copy?.statLabels?.classifier ?? 'Classifier'}
            value={stats.stage2Model?.replace('claude-', '') ?? 'default'}
            tooltip={classifierTooltip(stats)}
            detail={classifierDetail(stats)}
            to={settingsLinks.classifier}
          />
        </div>
      </Section>
      )}

      <div
        role="tabpanel"
        id={`settings-panel-${active}`}
        aria-labelledby={`settings-tab-${active}`}
        className="min-w-0"
      >
        {active === 'general' && <GeneralPanel />}
        {active === 'byok' && <ByokPanel />}
        {active === 'firecrawl' && <FirecrawlPanel />}
        {active === 'health' && <HealthPanel projectId={activeProjectId} projectName={projectName ?? stats.projectName} />}
        {active === 'dev' && <DevToolsPanel />}
      </div>
    </div>
  )
}
