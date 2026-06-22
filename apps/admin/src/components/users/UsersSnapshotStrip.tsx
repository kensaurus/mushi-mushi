/**
 * FILE: UsersSnapshotStrip.tsx
 * PURPOSE: Super-admin operator KPI strip — MetricStrip layout for UsersPage.
 *
 * OVERVIEW:
 * - Six StatCards in two MetricStrip rows (3 + 3)
 * - Tooltips from statTooltips/users; deep links from usersLinks
 *
 * DEPENDENCIES:
 * - MetricStrip, Section, StatCard, SnapshotSectionHint
 * - UsersStats from ./UsersStatsTypes
 *
 * USAGE:
 * - Mount via PagePosture on UsersPage with metrics from GET /v1/super-admin/metrics
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { UsersStats } from './UsersStatsTypes'
import {
  churn30dDetail,
  churn30dTooltip,
  mrrDetail,
  mrrTooltip,
  paidUsersDetail,
  paidUsersTooltip,
  signups30dDetail,
  signups30dTooltip,
  signups7dDetail,
  signups7dTooltip,
  totalSignupsDetail,
  totalSignupsTooltip,
} from '../../lib/statTooltips/users'
import { usersLinks } from '../../lib/statCardLinks'

interface Props {
  stats: UsersStats
  fetchedAt: string | null
  isValidating?: boolean
  sectionTitle?: string
  hint?: string
}

export function UsersSnapshotStrip({
  stats,
  fetchedAt,
  isValidating,
  sectionTitle = 'Users snapshot',
  hint,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: fetchedAt, isValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <div className="space-y-2">
        <MetricStrip cols={3} ariaLabel="Users snapshot primary">
          <StatCard
            label="Total signups"
            value={stats.total_users ?? '—'}
            tooltip={totalSignupsTooltip(stats)}
            detail={totalSignupsDetail()}
            to={usersLinks.totalSignups}
          />
          <StatCard
            label="Paid users"
            value={stats.paid_users ?? '—'}
            accent="text-brand"
            tooltip={paidUsersTooltip(stats)}
            detail={paidUsersDetail(stats)}
            to={usersLinks.paidUsers}
          />
          <StatCard
            label="MRR (USD)"
            value={`$${stats.mrr_usd.toLocaleString()}`}
            accent="text-brand"
            tooltip={mrrTooltip(stats)}
            detail={mrrDetail()}
            to={usersLinks.mrr}
          />
        </MetricStrip>
        <MetricStrip cols={3} ariaLabel="Users snapshot secondary">
          <StatCard
            label="Signups · 7d"
            value={stats.signups_last_7d ?? '—'}
            tooltip={signups7dTooltip(stats)}
            detail={signups7dDetail()}
            to={usersLinks.signups7d}
          />
          <StatCard
            label="Signups · 30d"
            value={stats.signups_last_30d ?? '—'}
            tooltip={signups30dTooltip(stats)}
            detail={signups30dDetail(stats)}
            to={usersLinks.signups30d}
          />
          <StatCard
            label="Churn · 30d"
            value={stats.churn_last_30d ?? '—'}
            accent={stats.churn_last_30d > 0 ? 'text-warn' : undefined}
            tooltip={churn30dTooltip(stats)}
            detail={churn30dDetail()}
            to={usersLinks.churn30d}
          />
        </MetricStrip>
      </div>
    </Section>
  )
}
