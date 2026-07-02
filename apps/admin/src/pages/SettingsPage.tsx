/**
 * FILE: apps/admin/src/pages/SettingsPage.tsx
 * PURPOSE: Tabbed shell for project settings. Each tab is a focused panel
 *          (general / BYOK / Firecrawl / health / dev tools), URL-driven via
 *          ?tab=… so deep links and the back-button behave correctly.
 */

import { useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageScopeHint, SnapshotSectionHint, SegmentedControl, StatCard, ErrorAlert, Panel, PanelSectionLabel } from '../components/ui'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { SettingsCompactSnapshot } from '../components/settings/SettingsCompactSnapshot'
import { GeneralPanel } from '../components/settings/GeneralPanel'
import { SettingsTabIntro } from '../components/settings/SettingsTabIntro'
import {
  SETTINGS_TAB_DESCRIPTIONS,
  SETTINGS_TAB_LABELS,
} from '../lib/settingsTabExplainer'
import { ByokPanel } from '../components/settings/ByokPanel'
import { FirecrawlPanel } from '../components/settings/FirecrawlPanel'
import { BrowserbasePanel } from '../components/settings/BrowserbasePanel'
import { HealthPanel } from '../components/settings/HealthPanel'
import { DevToolsPanel } from '../components/settings/DevToolsPanel'
import { SettingsIntegrationsReadout } from '../components/settings/SettingsIntegrationsReadout'
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
import { useSettingsUx, resolveQuickSettingsTab, shouldHideSettingsSnapshot } from '../lib/settingsModeUx'
import { usePublishPageContext } from '../lib/pageContext'
import { usePageData } from '../lib/usePageData'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
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
import { IconSettings } from '../components/icons'

const TABS: Array<{ id: SettingsTabId; label: string; description: string }> = [
  { id: 'general', label: SETTINGS_TAB_LABELS.general, description: SETTINGS_TAB_DESCRIPTIONS.general },
  { id: 'byok', label: SETTINGS_TAB_LABELS.byok, description: SETTINGS_TAB_DESCRIPTIONS.byok },
  { id: 'firecrawl', label: SETTINGS_TAB_LABELS.firecrawl, description: SETTINGS_TAB_DESCRIPTIONS.firecrawl },
  { id: 'browserbase', label: SETTINGS_TAB_LABELS.browserbase, description: SETTINGS_TAB_DESCRIPTIONS.browserbase },
  { id: 'health', label: SETTINGS_TAB_LABELS.health, description: SETTINGS_TAB_DESCRIPTIONS.health },
  { id: 'dev', label: SETTINGS_TAB_LABELS.dev, description: SETTINGS_TAB_DESCRIPTIONS.dev },
]

const TAB_TITLES: Record<SettingsTabId, string> = {
  general: SETTINGS_TAB_LABELS.general,
  byok: SETTINGS_TAB_LABELS.byok,
  firecrawl: SETTINGS_TAB_LABELS.firecrawl,
  browserbase: SETTINGS_TAB_LABELS.browserbase,
  health: SETTINGS_TAB_LABELS.health,
  dev: SETTINGS_TAB_LABELS.dev,
}

function isTabId(value: string | null): value is SettingsTabId {
  return TABS.some((t) => t.id === value)
}

const TAB_GROUPS: Array<{ label: string; tabs: SettingsTabId[] }> = [
  { label: 'Project', tabs: ['general', 'health'] },
  { label: 'Integrations', tabs: ['byok', 'firecrawl', 'browserbase'] },
  { label: 'Advanced', tabs: ['dev'] },
]

function settingsTabGroup(tab: SettingsTabId): string {
  return TAB_GROUPS.find((g) => g.tabs.includes(tab))?.label ?? 'Project'
}

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const copy = usePageCopy('/settings')
  const ux = useSettingsUx()
  const activeProjectId = useActiveProjectId()
  const setup = useSetupStatus(activeProjectId)
  const projectName = setup.activeProject?.project_name ?? null
  const projectSlug = setup.activeProject?.project_slug ?? null

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
  usePublishPageHeroStats('/settings', statsData)
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
      { id: 'general' as const, label: copy?.tabLabels?.general ?? SETTINGS_TAB_LABELS.general },
      {
        id: 'byok' as const,
        label: copy?.tabLabels?.byok ?? SETTINGS_TAB_LABELS.byok,
        count:
          stats.byokKeysFailing > 0
            ? stats.byokKeysFailing
            : stats.byokKeysUntested > 0
              ? stats.byokKeysUntested
              : undefined,
      },
      { id: 'firecrawl' as const, label: copy?.tabLabels?.firecrawl ?? SETTINGS_TAB_LABELS.firecrawl },
      { id: 'browserbase' as const, label: copy?.tabLabels?.browserbase ?? SETTINGS_TAB_LABELS.browserbase },
      { id: 'health' as const, label: copy?.tabLabels?.health ?? SETTINGS_TAB_LABELS.health },
      { id: 'dev' as const, label: copy?.tabLabels?.dev ?? SETTINGS_TAB_LABELS.dev },
    ],
    [stats.byokKeysFailing, stats.byokKeysUntested, copy?.tabLabels],
  )

  if (!activeProjectId) {
    return (
      <div className="space-y-4">
        <PageHeaderBar title={copy?.title ?? 'Project settings'} />
      <PageScopeHint text={copy?.description ?? "Per-project flags, LLM keys, SDK widget, and developer tools — scoped to the active project."} />
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
      <PageHeaderBar
        title={copy?.title ?? 'Project settings'}
        icon={<IconSettings />}
        projectScope={projectName ?? stats.projectName}
        helpTitle={copy?.help?.title ?? 'About Settings'}
        helpWhatIsIt={copy?.help?.whatIsIt ?? 'Project settings for the active app: your own LLM keys (optional), how bugs get classified, dedup sensitivity, widget copy, and developer toggles.'}
        helpUseCases={copy?.help?.useCases ?? [
          'Wire Slack so new bugs post to your triage channel with action buttons',
          'Connect Sentry so production errors become Mushi reports automatically',
          'Add your own AI keys if your company requires usage on your Anthropic/OpenAI account',
        ]}
        helpHowToUse={copy?.help?.howToUse ?? 'Start on General for Slack and triage behavior. Use AI keys only if you need BYOK. Click the (i) next to any field for what it does and when to change it.'}
      />

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: (
              <SettingsStatusBanner stats={stats} onTab={setActive} plainBanner={ux.plainBanner} />
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: !shouldHideSettingsSnapshot(ux, stats),
            children: (
              <>
                <PanelSectionLabel>{copy?.sections?.snapshot ?? 'Settings snapshot'}</PanelSectionLabel>
                <Panel>
                  <div className="px-4 pt-3 pb-2 border-b border-panel-border">
                    <SnapshotSectionHint text={activeMeta.description} />
                    {lastFetchedAt != null && (
                      <p className="mt-1 text-2xs text-fg-faint">
                        {isValidating ? 'Refreshing…' : `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`}
                      </p>
                    )}
                  </div>
                  <div className="panel--metrics grid gap-0 sm:grid-cols-2 lg:grid-cols-4">
                  <StatCard
                    label={copy?.statLabels?.byok ?? 'AI keys'}
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
                    accent={stats.slackConfigured || stats.sentryConfigured ? 'text-ok' : undefined}
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
                </Panel>
              </>
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: shouldHideSettingsSnapshot(ux, stats) && ux.isBeginner,
            children: (
              <SettingsCompactSnapshot
                stats={stats}
                statsFetchedAt={lastFetchedAt}
                statsValidating={isValidating}
                description={activeMeta.description}
                statLabels={copy?.statLabels}
                plainLanguage={ux.plainBanner}
              />
            ),
          },
        ]}
      />

      {!ux.hideTabs && (
      <div className="space-y-2">
        {shouldHideSettingsSnapshot(ux, stats) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-3xs text-fg-faint">
          {TAB_GROUPS.map((group) => (
            <span key={group.label}>
              <span className="font-medium uppercase tracking-wider text-fg-muted">{group.label}</span>
              {' — '}
              {group.tabs.map((id) => SETTINGS_TAB_LABELS[id]).join(', ')}
            </span>
          ))}
        </div>
        )}
      <SegmentedControl
        value={active}
        onChange={setActive}
        options={tabOptions}
        ariaLabel="Settings sections"
        scrollable
      />
      </div>
      )}

      {shouldHideSettingsSnapshot(ux, stats) && (
        <SettingsTabIntro
          tab={active}
          flags={{
            hasByokKey: stats.byokKeysConfigured > 0,
            slackConfigured: stats.slackConfigured,
            githubConfigured: stats.githubRepoConfigured,
          }}
        />
      )}

      {stats.projectId ? (
        <SettingsIntegrationsReadout
          stats={stats}
          fetchedAt={lastFetchedAt}
          validating={isValidating}
        />
      ) : null}

      <div
        role="tabpanel"
        id={`settings-panel-${active}`}
        aria-labelledby={`settings-tab-${active}`}
        className="min-w-0 space-y-3"
      >
        <PanelSectionLabel>{settingsTabGroup(active)}</PanelSectionLabel>
        {active === 'general' && <GeneralPanel />}
        {active === 'byok' && <ByokPanel />}
        {active === 'firecrawl' && <FirecrawlPanel />}
        {active === 'browserbase' && <BrowserbasePanel />}
        {active === 'health' && (
          <HealthPanel
            projectId={activeProjectId}
            projectName={projectName ?? stats.projectName}
            projectSlug={projectSlug}
          />
        )}
        {active === 'dev' && <DevToolsPanel />}
      </div>
    </div>
  )
}
