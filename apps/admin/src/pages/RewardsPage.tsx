/**
 * FILE: apps/admin/src/pages/RewardsPage.tsx
 * PURPOSE: Rewards program management — URL-driven tab layout with posture
 *          chrome budget, snapshot strip, and mode-aware navigation.
 */

import { useEffect } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { PublishingTab } from '../components/rewards/PublishingTab'
import { usePageData } from '../lib/usePageData'
import { usePublishPageHeroStats } from '../lib/heroSnapshots'
import { useEntitlements } from '../lib/useEntitlements'
import { useActiveOrgSignal } from '../lib/activeOrg'
import { usePublishPageContext } from '../lib/pageContext'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { RewardsStatusBanner } from '../components/rewards/RewardsStatusBanner'
import { RewardsEconomyGuide } from '../components/rewards/RewardsEconomyGuide'
import { RewardsSnapshotStrip } from '../components/rewards/RewardsSnapshotStrip'
import { RewardsTabNav } from '../components/rewards/RewardsTabNav'
import { EMPTY_REWARDS_STATS, type RewardsStats, type RewardsTabId } from '../components/rewards/types'
import { rewardsTabMeta, resolveRewardsTabParam } from '../components/rewards/rewardsTabs'
import { useRewardsUx, resolveQuickRewardsTab } from '../lib/rewardsModeUx'
import { Badge } from '../components/ui'
import {
  OverviewTab,
  ActivityRulesTab,
  TierLadderTab,
  ContributorsTab,
  SettingsTab,
  QuestsTab,
  RetentionAnalyticsTab,
  SandboxSimulatorTab,
} from '../components/rewards/tabs'

export function RewardsPage() {
  const orgId = useActiveOrgSignal()
  const { has } = useEntitlements()
  const rewardsEnabled = has('rewards_program')
  const canEdit = rewardsEnabled

  const {
    data: rewardsStatsData,
    reload: reloadRewardsStats,
    isValidating: rewardsStatsValidating,
    lastFetchedAt: rewardsStatsFetchedAt,
  } = usePageData<RewardsStats>('/v1/admin/rewards/stats')
  usePublishPageHeroStats('/rewards', rewardsStatsData)
  const rewardsStats = rewardsStatsData ?? EMPTY_REWARDS_STATS
  const ux = useRewardsUx(rewardsStats)

  const [searchParams, setSearchParams] = useSearchParams()
  const param = searchParams.get('tab')
  const active: RewardsTabId = resolveRewardsTabParam(param)
  const activeMeta = rewardsTabMeta(active)

  const setActive = (id: RewardsTabId) => {
    const next = new URLSearchParams(searchParams)
    if (id === 'overview') next.delete('tab')
    else next.set('tab', id)
    setSearchParams(next, { replace: true, preventScrollReset: true })
  }

  useEffect(() => {
    if (!ux.isQuickstart) return
    const resolved = resolveQuickRewardsTab(rewardsStats)
    const currentParam = searchParams.get('tab')
    const current: RewardsTabId = resolveRewardsTabParam(currentParam)
    if (resolved !== current) setActive(resolved)
    // Intentionally narrow deps: the quickstart tab follows posture only.
  }, [ux.isQuickstart, rewardsStats.topPriority, rewardsStats.organizationId])

  usePublishPageContext({
    route: '/rewards',
    title: `${activeMeta.label} · Rewards`,
    summary: activeMeta.description,
    filters: { tab: active },
  })

  const showHobbyInline =
    !rewardsEnabled && rewardsStats.organizationId != null && rewardsStats.topPriority !== 'no_org'

  if (param && param !== active) {
    const qs = new URLSearchParams(searchParams)
    if (active === 'overview') qs.delete('tab')
    else qs.set('tab', active)
    return <Navigate to={`/rewards?${qs.toString()}`} replace />
  }

  return (
    <div className="space-y-4">
      <PageHeaderBar
        title="Rewards"
        description="Incentivize users to report bugs, explore your app, and give feedback — earn points, tier badges, and perks."
        helpTitle="About Rewards"
        helpWhatIsIt="The Rewards program tracks user activity via the Mushi SDK, awards points for SDK events (screen views, session time, bug reports), and promotes users through tiers as they accumulate points. Each tier can carry perks — Pro access, monetary payouts, or host-defined credits applied via webhook."
        helpUseCases={[
          'Incentivize beta testers to report bugs by giving Pro access at the Contributor tier',
          'Reward power users with monetary payments (via Stripe Connect) at the Champion tier',
          'Use quests to guide new users through key flows while earning bonus points',
        ]}
        helpHowToUse="Configure activity rules to set points per SDK event, then define the tier ladder. Share the SDK snippet with your app and call identify() to link users. Monitor contributors in the leaderboard; use the Simulator tab to preview changes before going live."
      >
        {rewardsEnabled
          ? <Badge className="bg-ok-muted text-ok">Active</Badge>
          : <Badge className="bg-surface-overlay text-fg-muted">Hobby — read-only</Badge>}
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.status,
            children: (
              <RewardsStatusBanner
                stats={rewardsStats}
                rewardsEntitlement={rewardsEnabled}
                onTab={setActive}
                onRefresh={reloadRewardsStats}
                refreshing={rewardsStatsValidating}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: !ux.hideRewardsSnapshot,
            children: (
              <RewardsSnapshotStrip
                stats={rewardsStats}
                statsFetchedAt={rewardsStatsFetchedAt}
                statsValidating={rewardsStatsValidating}
                description={activeMeta.description}
                compact={ux.compactSnapshot}
                hideLinks={ux.hideSnapshotLinks}
              />
            ),
          },
          {
            priority: POSTURE_PRIORITY.guide,
            show: !ux.hideEconomyGuide,
            children: <RewardsEconomyGuide topPriority={rewardsStats.topPriority} />,
          },
        ]}
      />

      {showHobbyInline && (
        <div className="rounded-xl border border-warn/20 bg-warn/5 p-3 text-xs text-warn">
          <strong>Rewards program requires Starter or higher.</strong>{' '}
          <a href="/billing" className="underline">Upgrade your plan</a> to configure rules, tiers, and webhooks.
          You can preview the program below.
        </div>
      )}

      <RewardsTabNav active={active} onChange={setActive} hideTabs={ux.hideTabs} />

      {!ux.hideTabs && ux.hideRewardsSnapshot && (
        <p className="text-2xs text-fg-muted">{activeMeta.description}</p>
      )}

      {orgId && (
        <div
          role="tabpanel"
          id={`rewards-panel-${active}`}
          aria-labelledby={`rewards-tab-${active}`}
        >
          {active === 'overview' && <OverviewTab />}
          {active === 'publishing' && <PublishingTab />}
          {active === 'rules' && <ActivityRulesTab canEdit={canEdit} />}
          {active === 'tiers' && <TierLadderTab canEdit={canEdit} />}
          {active === 'contributors' && <ContributorsTab />}
          {active === 'quests' && <QuestsTab canEdit={canEdit} />}
          {active === 'analytics' && <RetentionAnalyticsTab />}
          {active === 'sandbox' && <SandboxSimulatorTab />}
          {active === 'settings' && <SettingsTab canEdit={canEdit} />}
        </div>
      )}
    </div>
  )
}
