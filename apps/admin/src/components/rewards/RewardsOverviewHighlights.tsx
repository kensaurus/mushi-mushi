/**
 * FILE: apps/admin/src/components/rewards/RewardsOverviewHighlights.tsx
 * PURPOSE: The top of Rewards → Overview (console journeys 2026-10-27):
 *          "are testers earning, and do I owe payouts?" as three cards: the
 *          top testers of the last 30 days, the payouts waiting, and the
 *          quests testers can work on. It replaces four tiles that repeated
 *          the page status above them.
 */

import { Link } from 'react-router-dom'
import { Card } from '../ui'
import { usePageData } from '../../lib/usePageData'

interface LeaderRow {
  end_user_id: string
  points_30d: number
  end_users: { external_user_id: string; display_name: string | null } | null
  reward_tiers: { display_name: string } | null
}

interface QuestRow {
  id: string
  name: string
  completion_points: number
  enabled: boolean
}

const LINK = 'text-2xs text-accent-foreground underline underline-offset-2 hover:text-accent'

function CardTitle({ children }: { children: string }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{children}</h3>
}

export function RewardsOverviewHighlights({ pendingPayoutUsd }: { pendingPayoutUsd: number }) {
  const leaders = usePageData<{ data: LeaderRow[] }>('/v1/admin/rewards/leaderboard?range=30d&limit=5&offset=0')
  const quests = usePageData<QuestRow[]>('/v1/admin/rewards/quests')
  const top = (leaders.data?.data ?? []).filter((r) => r.points_30d > 0)
  const live = (quests.data ?? []).filter((q) => q.enabled).sort((a, b) => b.completion_points - a.completion_points).slice(0, 3)

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="rewards-overview-highlights">
      <Card className="p-3">
        <CardTitle>Top testers · 30 days</CardTitle>
        {leaders.loading && !leaders.data ? (
          <p className="mt-2 text-xs text-fg-muted">Loading…</p>
        ) : top.length === 0 ? (
          <p className="mt-2 text-xs text-fg-muted">Nobody earned points in the last 30 days.</p>
        ) : (
          <ol aria-label="Top testers" className="mt-2 space-y-1">
            {top.map((r, i) => (
              <li key={r.end_user_id} className="flex min-w-0 items-center gap-2 text-xs">
                <span className="w-4 shrink-0 text-right tabular-nums text-fg-faint">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-fg">{r.end_users?.display_name ?? r.end_users?.external_user_id ?? 'Anonymous tester'}</span>
                {r.reward_tiers ? <span className="shrink-0 text-2xs text-fg-muted">{r.reward_tiers.display_name}</span> : null}
                <span className="shrink-0 font-mono tabular-nums text-fg-secondary">{r.points_30d.toLocaleString()} pts</span>
              </li>
            ))}
          </ol>
        )}
        <Link to="/rewards?tab=contributors" className={`mt-2 inline-block ${LINK}`}>
          See every tester →
        </Link>
      </Card>

      <Card className="p-3">
        <CardTitle>Payouts waiting</CardTitle>
        <p className={`mt-2 text-2xl font-semibold tabular-nums ${pendingPayoutUsd > 0 ? 'text-warn' : 'text-fg'}`}>${pendingPayoutUsd.toFixed(2)}</p>
        <p className="mt-1 text-xs text-fg-muted">
          {pendingPayoutUsd > 0
            ? 'Paid at the next monthly run, once each tester has finished Stripe’s identity check.'
            : 'Nothing owed to testers right now.'}
        </p>
        {pendingPayoutUsd > 0 ? (
          <Link to="/rewards?tab=settings" className={`mt-2 inline-block ${LINK}`}>
            Review payouts →
          </Link>
        ) : null}
      </Card>

      <Card className="p-3">
        <CardTitle>Quests</CardTitle>
        {quests.loading && !quests.data ? (
          <p className="mt-2 text-xs text-fg-muted">Loading…</p>
        ) : live.length === 0 ? (
          <p className="mt-2 text-xs text-fg-muted">No quests running. A quest walks new testers through a flow for bonus points.</p>
        ) : (
          <ul aria-label="Running quests" className="mt-2 space-y-1">
            {live.map((q) => (
              <li key={q.id} className="flex min-w-0 items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-fg">{q.name}</span>
                <span className="shrink-0 font-mono tabular-nums text-fg-secondary">+{q.completion_points} pts</span>
              </li>
            ))}
          </ul>
        )}
        <Link to="/rewards?tab=quests" className={`mt-2 inline-block ${LINK}`}>
          {live.length === 0 ? 'Add a quest →' : 'Manage quests →'}
        </Link>
      </Card>
    </div>
  )
}
