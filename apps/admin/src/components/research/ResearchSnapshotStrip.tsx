/**
 * FILE: ResearchSnapshotStrip.tsx
 * PURPOSE: Research corpus KPI strip using MetricStrip — replaces hand-rolled grid on ResearchPage.
 */

import { Section, StatCard, SnapshotSectionHint } from '../ui'
import { MetricStrip } from '../MetricStrip'
import type { ResearchStats } from './ResearchStatsTypes'
import {
  sessionsTooltip,
  sessionsDetail,
  snippetsTooltip,
  snippetsDetail,
  attachedTooltip,
  attachedDetail,
  unattachedSnippetsTooltip,
  unattachedSnippetsDetail,
  firecrawlTooltip,
  firecrawlDetail,
  domainsTooltip,
  domainsDetail,
} from '../../lib/statTooltips/research'
import { researchLinks } from '../../lib/statCardLinks'

interface Props {
  stats: ResearchStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  sectionTitle?: string
  hint?: string
  statLabels?: Record<string, string>
}

export function ResearchSnapshotStrip({
  stats,
  statsFetchedAt,
  statsValidating,
  sectionTitle = 'RESEARCH SNAPSHOT',
  hint,
  statLabels,
}: Props) {
  return (
    <Section title={sectionTitle} freshness={{ at: statsFetchedAt, isValidating: statsValidating }}>
      {hint ? <SnapshotSectionHint text={hint} /> : null}
      <MetricStrip cols={6} ariaLabel="Research snapshot">
        <StatCard
          label={statLabels?.sessions ?? 'Sessions'}
          value={stats.sessions}
          accent={stats.sessions > 0 ? 'text-brand' : undefined}
          tooltip={sessionsTooltip(stats)}
          detail={sessionsDetail()}
          to={researchLinks.sessions}
        />
        <StatCard
          label={statLabels?.snippets ?? 'Snippets'}
          value={stats.snippets}
          accent={stats.snippets > 0 ? 'text-brand' : undefined}
          tooltip={snippetsTooltip(stats)}
          detail={snippetsDetail()}
          to={researchLinks.snippets}
        />
        <StatCard
          label={statLabels?.attached ?? 'Attached'}
          value={stats.attached}
          accent={stats.attached > 0 ? 'text-ok' : undefined}
          tooltip={attachedTooltip(stats)}
          detail={attachedDetail()}
          to={researchLinks.attached}
        />
        <StatCard
          label={statLabels?.unattached ?? 'Unattached'}
          value={stats.unattachedSnippets}
          accent={stats.unattachedSnippets > 0 ? 'text-warn' : undefined}
          tooltip={unattachedSnippetsTooltip(stats)}
          detail={unattachedSnippetsDetail()}
          to={researchLinks.unattached}
        />
        <StatCard
          label={statLabels?.firecrawl ?? 'Firecrawl'}
          value={stats.firecrawlReady ? 'Ready' : stats.firecrawlConfigured ? 'Test' : 'Setup'}
          accent={
            stats.firecrawlReady
              ? 'text-ok'
              : stats.firecrawlConfigured
                ? 'text-warn'
                : undefined
          }
          tooltip={firecrawlTooltip(stats)}
          detail={firecrawlDetail(stats)}
          to={researchLinks.firecrawl}
        />
        <StatCard
          label={statLabels?.domains ?? 'Domains'}
          value={stats.allowedDomainsCount}
          accent={stats.allowedDomainsCount > 0 ? 'text-info' : undefined}
          tooltip={domainsTooltip(stats)}
          detail={domainsDetail(stats)}
          to={researchLinks.domains}
        />
      </MetricStrip>
    </Section>
  )
}
