/**
 * FILE: apps/admin/src/pages/SettingsPage.tsx
 * PURPOSE: Tabbed shell for project settings. Each tab is one card holding a
 *          list of rows (components/settings/SettingsRow.tsx); endpoints and
 *          raw numbers sit in a collapsed "Developer details" at the bottom.
 *
 *          Tab choice: the ?tab= link wins, then the tab you last used on this
 *          project (remembered in this browser), then Quick mode's pick.
 *          Old tab ids (`firecrawl`, `health`, …) go through
 *          lib/settingsTabs.ts: the URL is rewritten to the new tab, with the
 *          section it pointed at as the #hash, and the page scrolls there.
 *
 *          The banner and the AI keys tab badge are worked out from the same
 *          saved-keys list the key rows use (ByokPoolProvider + keyStatus.ts),
 *          so the banner can never say "all good" while a row says otherwise.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { PAGE_CONTENT_STACK } from '../lib/pageLayout';
import { PageScopeHint, SegmentedControl, StatCard, ErrorAlert } from '../components/ui';
import { PageHeaderBar } from '../components/PageHeaderBar';
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture';
import { GeneralPanel } from '../components/settings/GeneralPanel';
import { SpendLimitsPanel } from '../components/settings/SpendLimitsPanel';
import { SETTINGS_TAB_DESCRIPTIONS, SETTINGS_TAB_LABELS } from '../lib/settingsTabExplainer';
import { ByokPanel } from '../components/settings/ByokPanel';
import { FirecrawlPanel } from '../components/settings/FirecrawlPanel';
import { BrowserbasePanel } from '../components/settings/BrowserbasePanel';
import { VoiceIntakePanel } from '../components/settings/VoiceIntakePanel';
import { HealthPanel } from '../components/settings/HealthPanel';
import { DevToolsPanel } from '../components/settings/DevToolsPanel';
import { SettingsIntegrationsReadout } from '../components/settings/SettingsIntegrationsReadout';
import { SettingsStatusBanner } from '../components/settings/SettingsStatusBanner';
import { DeveloperDetails } from '../components/settings/SettingsRow';
import { ByokPoolProvider, useByokPool } from '../components/settings/ByokPoolContext';
import { hasWorkingPoolKey, summarizeKeys, type KeySummary } from '../components/settings/keyStatus';
import {
  EMPTY_SETTINGS_STATS,
  SETTINGS_TAB_IDS,
  type SettingsStats,
  type SettingsTabId,
} from '../components/settings/types';
import {
  SETTINGS_SECTION_IDS,
  isStoredSettingsTab,
  normalizeSettingsLocation,
  resolveSettingsTab,
} from '../lib/settingsTabs';
import { useScrollToHash } from '../lib/useScrollToHash';
import { SetupNudge } from '../components/SetupNudge';
import { useActiveProjectId } from '../components/ProjectSwitcher';
import { useSetupStatus } from '../lib/useSetupStatus';
import { usePageCopy } from '../lib/copy';
import {
  useSettingsUx,
  resolveQuickSettingsTab,
  shouldResolveQuickSettingsTab,
} from '../lib/settingsModeUx';
import { usePublishPageContext } from '../lib/pageContext';
import { usePageData } from '../lib/usePageData';
import { usePublishPageHeroStats } from '../lib/heroSnapshots';
import { usePersistentState } from '../lib/usePersistentState';
import { useEntitlements } from '../lib/useEntitlements';
import {
  byokDetail,
  byokTooltip,
  classifierDetail,
  classifierTooltip,
  routingDetail,
  routingTooltip,
  sdkDetail,
  sdkTooltip,
} from '../lib/statTooltips/settings';
import { settingsLinks } from '../lib/statCardLinks';
import { useRealtimeReload } from '../lib/realtime';
import { PanelSkeleton } from '../components/skeletons/PanelSkeleton';
import { IconSettings } from '../components/icons';

export function SettingsPage() {
  const entitlements = useEntitlements();
  const byokEnabled = !entitlements.loading && entitlements.has('byok');
  return (
    <ByokPoolProvider enabled={byokEnabled}>
      <SettingsPageBody byokEnabled={byokEnabled} entitlementsLoading={entitlements.loading} />
    </ByokPoolProvider>
  );
}

function SettingsPageBody({
  byokEnabled,
  entitlementsLoading,
}: {
  byokEnabled: boolean;
  entitlementsLoading: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const copy = usePageCopy('/settings');
  const ux = useSettingsUx();
  const activeProjectId = useActiveProjectId();
  const setup = useSetupStatus(activeProjectId);
  const projectName = setup.activeProject?.project_name ?? null;
  const projectSlug = setup.activeProject?.project_slug ?? null;

  // Stored as a string: a browser may still remember an old id ('health'),
  // which resolveSettingsTab maps onto its new tab.
  const [storedTab, setStoredTab] = usePersistentState<string | null>('settings:tab', null, {
    projectId: activeProjectId,
    validate: isStoredSettingsTab,
  });
  const param = searchParams.get('tab');
  // Quick mode hides the tab strip, so a remembered tab could strand you on
  // it; there the link or Quick mode's own pick decides.
  const rememberedTab = ux.hideTabs ? null : (resolveSettingsTab(storedTab)?.tab ?? null);
  const active: SettingsTabId = resolveSettingsTab(param)?.tab ?? rememberedTab ?? 'general';

  // An old id in the link (?tab=health) shows the right tab straight away;
  // this then rewrites the URL to the new id and adds the section's #hash.
  useEffect(() => {
    const next = normalizeSettingsLocation(location.search, location.hash);
    if (!next) return;
    navigate(
      { pathname: location.pathname, search: next.search, hash: next.hash },
      { replace: true, preventScrollReset: true },
    );
  }, [location.pathname, location.search, location.hash, navigate]);

  const statsPath = activeProjectId ? '/v1/admin/settings/stats' : null;
  const {
    data: statsData,
    loading: statsLoading,
    error: statsError,
    reload: reloadStats,
    lastFetchedAt,
    isValidating,
  } = usePageData<SettingsStats>(statsPath);
  usePublishPageHeroStats('/settings', statsData);
  const stats = { ...EMPTY_SETTINGS_STATS, ...statsData };

  const pool = useByokPool(byokEnabled);
  const keySummary: KeySummary | null = useMemo(() => {
    if (!byokEnabled || !pool.data) return null;
    return summarizeKeys(pool.data.keys ?? [], pool.data.legacyKeys ?? []);
  }, [byokEnabled, pool.data]);
  const hasAnthropicKey = useMemo(() => {
    if (!pool.data) return stats.byokAnthropicConfigured;
    return (
      hasWorkingPoolKey(pool.data.keys ?? [], 'anthropic') ||
      (pool.data.legacyKeys ?? []).some((k) => k.provider_slug === 'anthropic')
    );
  }, [pool.data, stats.byokAnthropicConfigured]);

  const reloadAll = useCallback(() => {
    reloadStats();
  }, [reloadStats]);

  useRealtimeReload(['project_settings'], reloadAll);

  const setActive = useCallback(
    (id: SettingsTabId) => {
      setStoredTab(id);
      const next = new URLSearchParams(searchParams);
      if (id === 'general') next.delete('tab');
      else next.set('tab', id);
      setSearchParams(next, { replace: true, preventScrollReset: true });
    },
    [searchParams, setSearchParams, setStoredTab],
  );

  // Quick mode picks a starting tab when no link says which one to show.
  // It waits for the saved-keys list too, so it picks from the same counts
  // the banner shows.
  // It picks once per visit: after that, a tab the user opens stays open.
  const poolPending = byokEnabled && pool.loading && !pool.data;
  // Scroll to a #section (#firecrawl, #key-supabase, …) once the panels that
  // hold those ids can render: the AI keys rows wait for the saved-keys list.
  useScrollToHash(Boolean(statsData) && !entitlementsLoading && !poolPending);
  const quickPicked = useRef(false);
  useEffect(() => {
    if (!ux.isQuickstart || !activeProjectId || statsLoading || poolPending || quickPicked.current) return;
    quickPicked.current = true;
    if (!shouldResolveQuickSettingsTab(param) || rememberedTab !== null) return;
    const quickTab = resolveQuickSettingsTab(stats, keySummary, hasAnthropicKey, byokEnabled);
    if (active !== quickTab) setActive(quickTab);
  }, [
    ux.isQuickstart,
    activeProjectId,
    statsLoading,
    poolPending,
    stats,
    keySummary,
    hasAnthropicKey,
    byokEnabled,
    active,
    param,
    rememberedTab,
    setActive,
  ]);

  const keyProblems = keySummary ? keySummary.attention + keySummary.expiring + keySummary.checking : 0;
  const criticalCount =
    (keySummary ? keySummary.attention + keySummary.expiring : stats.byokKeysFailing) +
    (!hasAnthropicKey ? 1 : 0) +
    (!stats.sdkConfigEnabled ? 1 : 0) +
    (keySummary ? keySummary.checking : stats.byokKeysUntested);

  usePublishPageContext({
    route: '/settings',
    title: `${SETTINGS_TAB_LABELS[active]} · Settings`,
    summary: SETTINGS_TAB_DESCRIPTIONS[active],
    filters: { tab: active, project_id: activeProjectId ?? undefined },
    criticalCount,
  });

  const tabOptions = useMemo(
    () =>
      SETTINGS_TAB_IDS.map((id) => ({
        id,
        label: SETTINGS_TAB_LABELS[id],
        count: id === 'byok' && keyProblems > 0 ? keyProblems : undefined,
      })),
    [keyProblems],
  );

  if (!activeProjectId) {
    return (
      <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-settings">
        <PageHeaderBar title={copy?.title ?? 'Project settings'} />
        <PageScopeHint
          text={
            copy?.description ??
            'Per-project alerts, your AI keys, the bug widget, and developer options for the project you pick.'
          }
        />
        <SetupNudge
          requires={['project']}
          emptyTitle="Select a project"
          emptyDescription="Settings apply to the project in the header. Pick your app first."
        />
      </div>
    );
  }

  if (statsLoading && !statsData) {
    return <PanelSkeleton rows={6} label="Loading settings" />;
  }
  if (statsError) {
    return <ErrorAlert message={`Couldn't load your settings: ${statsError}`} onRetry={reloadAll} />;
  }

  return (
    <div className="space-y-4" data-testid="mushi-page-settings">
      <PageHeaderBar
        title={copy?.title ?? 'Project settings'}
        icon={<IconSettings />}
        projectScope={projectName ?? stats.projectName}
        helpTitle={copy?.help?.title ?? 'About Settings'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'Settings for the active app: where bug alerts go, your own AI keys (optional), how bugs are sorted, the feedback widget, and developer options.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'Send new bugs to a Slack channel with Triage and Fix buttons',
            'Turn Sentry errors into Mushi reports automatically',
            'Use your own Anthropic or OpenAI key so AI usage bills your account',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ??
          'Each tab is a list. Every row says what it does, whether it works, and the one thing to do next.'
        }
      />

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: (
              <SettingsStatusBanner
                stats={stats}
                keySummary={keySummary}
                hasAnthropicKey={hasAnthropicKey}
                onTab={setActive}
                plainBanner={ux.plainBanner}
              />
            ),
          },
        ]}
      />

      {!ux.hideTabs && (
        <SegmentedControl
          value={active}
          onChange={setActive}
          options={tabOptions}
          ariaLabel="Settings sections"
          scrollable
        />
      )}

      <div
        role="tabpanel"
        id={`settings-panel-${active}`}
        aria-labelledby={`settings-tab-${active}`}
        className="min-w-0 space-y-4"
      >
        {active === 'general' && (
          <>
            <GeneralPanel />
            <SpendLimitsPanel />
          </>
        )}
        {active === 'byok' && <ByokPanel />}
        {active === 'tools' && (
          <>
            <div id={SETTINGS_SECTION_IDS.firecrawl} className="scroll-mt-6 space-y-4">
              <FirecrawlPanel />
            </div>
            <div id={SETTINGS_SECTION_IDS.browserbase} className="scroll-mt-6 space-y-4">
              <BrowserbasePanel />
            </div>
          </>
        )}
        {active === 'voice' && <VoiceIntakePanel />}
        {active === 'sdk' && (
          <>
            <div id={SETTINGS_SECTION_IDS.connection} className="scroll-mt-6 space-y-4">
              <HealthPanel
                projectId={activeProjectId}
                projectName={projectName ?? stats.projectName}
                projectSlug={projectSlug}
              />
            </div>
            <div id={SETTINGS_SECTION_IDS.debugLogging} className="scroll-mt-6 space-y-4">
              <DevToolsPanel />
            </div>
          </>
        )}
      </div>

      {stats.projectId ? (
        <DeveloperDetails storageKey="settings" projectId={activeProjectId}>
          <div className="space-y-4">
            <div className="panel--metrics grid gap-0 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label={copy?.statLabels?.byok ?? 'AI keys'}
                value={stats.byokKeysConfigured}
                tooltip={byokTooltip(stats)}
                detail={byokDetail(stats)}
                to={settingsLinks.byok}
              />
              <StatCard
                label={copy?.statLabels?.sdk ?? 'Bug widget'}
                value={stats.sdkConfigEnabled ? 'On' : 'Off'}
                tooltip={sdkTooltip(stats)}
                detail={sdkDetail(stats)}
                to={settingsLinks.sdk}
              />
              <StatCard
                label={copy?.statLabels?.routing ?? 'Alerts'}
                value={
                  [stats.slackConfigured && 'Slack', stats.sentryConfigured && 'Sentry']
                    .filter(Boolean)
                    .join(' · ') || 'None'
                }
                tooltip={routingTooltip(stats)}
                detail={routingDetail()}
                to={settingsLinks.routing}
              />
              <StatCard
                label={copy?.statLabels?.classifier ?? 'Triage model'}
                value={stats.stage2Model?.replace('claude-', '') ?? 'default'}
                tooltip={classifierTooltip(stats)}
                detail={classifierDetail(stats)}
                to={settingsLinks.classifier}
              />
            </div>
            <SettingsIntegrationsReadout stats={stats} fetchedAt={lastFetchedAt} validating={isValidating} />
          </div>
        </DeveloperDetails>
      ) : null}
    </div>
  );
}
