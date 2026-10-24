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
 *          The banner, the AI keys tab badge and the General Slack/Sentry rows
 *          share one verdict (key list, slackConnection, sentrySettingsState,
 *          Integrations stats). The banner cannot say everything is working
 *          while a row or the Integrations page says otherwise.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { PAGE_CONTENT_STACK } from '../lib/pageLayout';
import { PageScopeHint, SegmentedControl, StatCard, ErrorAlert } from '../components/ui';
import { PageHeaderBar } from '../components/PageHeaderBar';
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture';
import { GeneralPanel, SETTINGS_SLACK_COPY } from '../components/settings/GeneralPanel';
import { SpendLimitsPanel } from '../components/settings/SpendLimitsPanel';
import { AgentPrReviewCard } from '../components/settings/AgentPrReviewCard';
import { VerifiedMergeCard } from '../components/settings/VerifiedMergeCard';
import { CiCostSettingsCard } from '../components/settings/CiCostSettingsCard';
import { CiPolicyCard } from '../components/settings/CiPolicyCard';
import { SETTINGS_TAB_DESCRIPTIONS, SETTINGS_TAB_LABELS } from '../lib/settingsTabExplainer';
import { ByokPanel } from '../components/settings/ByokPanel';
import { FirecrawlPanel } from '../components/settings/FirecrawlPanel';
import { KnownIssuesSearchCard } from '../components/settings/KnownIssuesSearchCard';
import { BrowserbasePanel } from '../components/settings/BrowserbasePanel';
import { VoiceIntakePanel } from '../components/settings/VoiceIntakePanel';
import { HealthPanel } from '../components/settings/HealthPanel';
import { DevToolsPanel } from '../components/settings/DevToolsPanel';
import { LabsPanel } from '../components/settings/LabsPanel';
import { SettingsIntegrationsReadout } from '../components/settings/SettingsIntegrationsReadout';
import { SettingsStatusBanner, settingsBannerPriority, type SettingsBannerContext } from '../components/settings/SettingsStatusBanner';
import { newestProbe, sentrySettingsState, slackConnection, type ProbeLike } from '../lib/integrationConnection';
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
import { NextStep } from '../components/NextStep';
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
  const stats = { ...EMPTY_SETTINGS_STATS, ...statsData };
  const [slackSessionProbe, setSlackSessionProbe] = useState<ProbeLike | undefined>(undefined);
  const historyQuery = usePageData<{
    history: Array<{ kind: string; status: string; message: string | null; checked_at: string }>;
  }>(activeProjectId ? '/v1/admin/health/history' : null);
  const integrationQuery = usePageData<{ platformDown?: number; platformAttention?: number }>(
    activeProjectId ? '/v1/admin/integrations/stats' : null,
  );

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

  const serverSlackProbe = useMemo((): ProbeLike | undefined => {
    const row = historyQuery.data?.history.find((h) => h.kind === 'slack');
    if (!row) return undefined;
    const status = row.status;
    if (status !== 'ok' && status !== 'degraded' && status !== 'down' && status !== 'unknown') return undefined;
    return { status: status as ProbeLike['status'], message: row.message, checked_at: row.checked_at };
  }, [historyQuery.data]);
  const slackProbe = newestProbe(serverSlackProbe, slackSessionProbe);
  const historySettled = historyQuery.data !== null || Boolean(historyQuery.error);

  const bannerContext = useMemo((): SettingsBannerContext => {
    const channels: NonNullable<SettingsBannerContext['channels']> = {};
    if (stats.slackConfigured && stats.slackCanPost !== true) {
      const view = slackConnection({
        configured: true,
        canPost: false,
        channelId: stats.slackChannelId ?? null,
        copy: SETTINGS_SLACK_COPY,
      });
      channels.slack = view.state;
      channels.slackDetail = view.detail;
    } else if (stats.slackConfigured && stats.slackCanPost === true && (historySettled || slackSessionProbe)) {
      const view = slackConnection({
        configured: true,
        canPost: true,
        channelId: stats.slackChannelId ?? null,
        probe: slackProbe,
        copy: SETTINGS_SLACK_COPY,
      });
      channels.slack = view.state;
      channels.slackDetail = view.detail;
    } else if (!stats.slackConfigured) {
      channels.slack = 'not_connected';
    }
    if (stats.sentryWebhookSecretSet !== undefined) {
      const view = sentrySettingsState({
        dsnSaved: stats.sentryConfigured,
        webhookSecretSaved: stats.sentryWebhookSecretSet,
      });
      channels.sentry = view.state;
      channels.sentryDetail = view.detail;
    }
    return {
      channels,
      // A failed read stays null so we do not invent "0 need attention".
      integrations: integrationQuery.data
        ? { down: integrationQuery.data.platformDown ?? 0, attention: integrationQuery.data.platformAttention ?? 0 }
        : null,
    };
  }, [stats, historySettled, integrationQuery.data, slackProbe, slackSessionProbe]);

  const reloadHistory = historyQuery.reload;
  const reloadIntegrationStats = integrationQuery.reload;
  const reloadAlerts = useCallback(() => {
    reloadStats();
    reloadHistory();
    reloadIntegrationStats();
  }, [reloadStats, reloadHistory, reloadIntegrationStats]);

  const reloadAll = useCallback(() => {
    reloadAlerts();
  }, [reloadAlerts]);

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
  const signalsPending =
    Boolean(stats.slackConfigured && stats.slackCanPost === true && !historySettled && !slackSessionProbe) ||
    Boolean(activeProjectId && integrationQuery.loading && !integrationQuery.data && !integrationQuery.error);
  const bannerPriority = settingsBannerPriority(stats, keySummary, hasAnthropicKey, bannerContext);
  const holdAllClear =
    signalsPending && (bannerPriority === 'healthy' || bannerPriority === 'routing_optional');
  useEffect(() => {
    if (!ux.isQuickstart || !activeProjectId || statsLoading || poolPending || signalsPending || quickPicked.current) return;
    quickPicked.current = true;
    if (!shouldResolveQuickSettingsTab(param) || rememberedTab !== null) return;
    const quickTab = resolveQuickSettingsTab(stats, keySummary, hasAnthropicKey, byokEnabled, bannerContext);
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
    bannerContext,
    signalsPending,
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
    (keySummary ? keySummary.checking : stats.byokKeysUntested) +
    (bannerContext.channels?.slack === 'attention' ? 1 : 0) +
    (bannerContext.channels?.sentry === 'attention' ? 1 : 0) +
    (bannerContext.integrations?.down ?? 0) +
    (bannerContext.integrations?.attention ?? 0);

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
        <PageHeaderBar title={copy?.title ?? 'Settings'} />
        <PageScopeHint
          text={
            copy?.description ??
            'Per-project alerts, your AI keys, the bug widget, and developer options for the project you pick.'
          }
        />
        <NextStep
          variant="inline"
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
        title={copy?.title ?? 'Settings'}
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
            children: holdAllClear ? null : (
              <SettingsStatusBanner
                stats={stats}
                keySummary={keySummary}
                hasAnthropicKey={hasAnthropicKey}
                context={bannerContext}
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
            <GeneralPanel
              alerts={{
                slackConfigured: stats.slackConfigured,
                slackCanPost: stats.slackCanPost === true,
                slackChannelId: stats.slackChannelId ?? null,
                probe: slackProbe,
              }}
              onSlackTested={setSlackSessionProbe}
              onAlertsChanged={reloadAlerts}
            />
            <SpendLimitsPanel />
            <AgentPrReviewCard projectId={activeProjectId} />
            <VerifiedMergeCard projectId={activeProjectId} />
            <CiCostSettingsCard projectId={activeProjectId} />
            <CiPolicyCard projectId={activeProjectId} />
          </>
        )}
        {active === 'byok' && <ByokPanel />}
        {active === 'tools' && (
          <>
            <div id={SETTINGS_SECTION_IDS.firecrawl} className="scroll-mt-6 space-y-4">
              <FirecrawlPanel />
            </div>
            <KnownIssuesSearchCard projectId={activeProjectId} id={SETTINGS_SECTION_IDS.knownIssuesSearch} />
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
        {active === 'labs' && <LabsPanel />}
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
