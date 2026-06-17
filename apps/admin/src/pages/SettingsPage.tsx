/**
 * FILE: apps/admin/src/pages/SettingsPage.tsx
 * PURPOSE: Tabbed shell for project settings. Each tab is a focused panel
 *          (general / BYOK / Firecrawl / health / dev tools), URL-driven via
 *          ?tab=… so deep links and the back-button behave correctly.
 */

import { useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageScopeHint,SnapshotSectionHint,Section, SegmentedControl, StatCard, ErrorAlert, Card } from '../components/ui'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { GeneralPanel } from '../components/settings/GeneralPanel'
import { ByokPanel } from '../components/settings/ByokPanel'
import { FirecrawlPanel } from '../components/settings/FirecrawlPanel'
import { BrowserbasePanel } from '../components/settings/BrowserbasePanel'
import { HealthPanel } from '../components/settings/HealthPanel'
import { DevToolsPanel } from '../components/settings/DevToolsPanel'
import { SettingsStatusBanner } from '../components/settings/SettingsStatusBanner'
import {
  ActionPill,
  ActionPillRow,
  ContainedBlock,
  SignalChip,
} from '../components/report-detail/ReportSurface'
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
  { id: 'browserbase', label: 'Browserbase', description: 'BYOK Browserbase API key for cloud Chromium QA runs.' },
  { id: 'health', label: 'Health', description: 'Connection status, SDK reference, pipeline smoke test.' },
  { id: 'dev', label: 'Dev tools', description: 'SDK widget toggles and local-only debug flags.' },
]

const TAB_TITLES: Record<SettingsTabId, string> = {
  general: 'General',
  byok: 'BYOK',
  firecrawl: 'Firecrawl',
  browserbase: 'Browserbase',
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
      { id: 'browserbase' as const, label: copy?.tabLabels?.browserbase ?? 'Browserbase' },
      { id: 'health' as const, label: copy?.tabLabels?.health ?? 'Health' },
      { id: 'dev' as const, label: copy?.tabLabels?.dev ?? 'Dev' },
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
        projectScope={projectName ?? stats.projectName}
        description={copy?.description ?? 'Per-project flags, retention, routing defaults, and feature toggles — saved per project.'}
        helpTitle={copy?.help?.title ?? 'About Settings'}
        helpWhatIsIt={copy?.help?.whatIsIt ?? 'Project-level configuration scoped to the header project: BYOK LLM keys, classifier model, dedup threshold, SDK widget, and developer toggles.'}
        helpUseCases={copy?.help?.useCases ?? [
          'Bring your own Anthropic / OpenAI keys so cost stays on your bill',
          'Run Health → Send test report before wiring production SDK traffic',
          'Tune Stage-2 model and dedup threshold after you see false positives in triage',
        ]}
        helpHowToUse={copy?.help?.howToUse ?? 'General saves Slack/Sentry + classifier fields. LLM keys tab tests BYOK. Health runs a pipeline smoke test. Changes write to project_settings immediately on Save.'}
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
        <SnapshotSectionHint text={activeMeta.description} />
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

      {stats.topPriority &&
        stats.topPriority !== 'healthy' &&
        stats.topPriority !== 'routing_optional' &&
        stats.topPriorityTo && (
        <Card
          className={`space-y-3 p-4 ${
            stats.topPriority === 'byok_failing'
              ? 'border-danger/30 bg-danger/5'
              : stats.topPriority === 'no_anthropic' || stats.topPriority === 'sdk_off'
                ? 'border-warn/30 bg-warn/5'
                : 'border-brand/30 bg-brand/5'
          }`}
        >
          <SignalChip
            tone={
              stats.topPriority === 'byok_failing'
                ? 'danger'
                : stats.topPriority === 'no_anthropic' || stats.topPriority === 'sdk_off'
                  ? 'warn'
                  : 'brand'
            }
          >
            Needs attention
          </SignalChip>
          <ContainedBlock tone={stats.topPriority === 'byok_failing' ? 'warn' : 'info'}>
            <p className="text-xs font-medium leading-snug text-fg">
              {stats.topPriorityLabel ?? 'Review project settings before production traffic.'}
            </p>
          </ContainedBlock>
          <ActionPillRow>
            <ActionPill to={stats.topPriorityTo} tone="brand">
              Take action →
            </ActionPill>
          </ActionPillRow>
        </Card>
      )}

      {ux.hideSettingsSnapshot && (
        <ContainedBlock tone="muted" className="mb-1">
          <p className="text-2xs leading-relaxed text-fg-muted">{activeMeta.description}</p>
        </ContainedBlock>
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
