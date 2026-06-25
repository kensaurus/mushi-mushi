/**
 * SETTINGS COMPACT SNAPSHOT — headline stats when the full 4-tile grid is hidden
 * (Quickstart or Beginner with an active status banner).
 */

import { MetricStrip } from '../MetricStrip'
import { Section, StatCard, SnapshotSectionHint } from '../ui'
import type { SettingsStats } from './types'
import {
  byokDetail,
  byokTooltip,
  routingDetail,
  routingTooltip,
  sdkDetail,
  sdkTooltip,
} from '../../lib/statTooltips/settings'
import { settingsLinks } from '../../lib/statCardLinks'

interface Props {
  stats: SettingsStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  description?: string
  statLabels?: Record<string, string>
  plainLanguage?: boolean
}

/** Three complementary metrics — avoids duplicating the status banner headline. */
export function SettingsCompactSnapshot({
  stats,
  statsFetchedAt,
  statsValidating,
  description,
  statLabels,
  plainLanguage = false,
}: Props) {
  const tipOpts = { plainLanguage }
  return (
    <Section
      title="Settings at a glance"
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
    >
      <SnapshotSectionHint text={description} />
      <MetricStrip cols={3} ariaLabel="Settings headline metrics">
        <StatCard
          label={statLabels?.byok ?? 'AI keys'}
          value={stats.byokKeysConfigured}
          accent={
            stats.byokKeysFailing > 0
              ? 'text-danger'
              : stats.byokKeysPassing > 0
                ? 'text-ok'
                : undefined
          }
          tooltip={byokTooltip(stats, tipOpts)}
          detail={byokDetail(stats)}
          to={settingsLinks.byok}
        />
        <StatCard
          label={statLabels?.sdk ?? 'SDK widget'}
          value={stats.sdkConfigEnabled ? 'On' : 'Off'}
          accent={stats.sdkConfigEnabled ? 'text-ok' : 'text-warn'}
          tooltip={sdkTooltip(stats)}
          detail={sdkDetail(stats)}
          to={settingsLinks.sdk}
        />
        <StatCard
          label={statLabels?.routing ?? 'Routing'}
          value={[stats.slackConfigured && 'Slack', stats.sentryConfigured && 'Sentry']
            .filter(Boolean)
            .join(' · ') || 'None'}
          accent={stats.slackConfigured || stats.sentryConfigured ? 'text-brand' : undefined}
          tooltip={routingTooltip(stats, tipOpts)}
          detail={routingDetail()}
          to={settingsLinks.routing}
        />
      </MetricStrip>
    </Section>
  )
}
