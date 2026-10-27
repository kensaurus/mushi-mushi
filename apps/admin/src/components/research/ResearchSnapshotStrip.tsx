/**
 * FILE: ResearchSnapshotStrip.tsx
 * PURPOSE: Research status: web searches about your bugs and what is not yet
 *          attached to one (PageStatus, P1). Once web search works and nothing
 *          was searched, it is the page's one first step (P3).
 */

import { PageStatus } from '../ui'
import type { ResearchStats } from './ResearchStatsTypes'
import { pluralizeWithCount } from '../../lib/format'
import { researchLinks } from '../../lib/statCardLinks'

interface Props {
  stats: ResearchStats
  statsFetchedAt: string | null
  statsValidating?: boolean
  statLabels?: Record<string, string>
  /** Opens the search box: the first step once web search is set up. */
  onSearch?: () => void
}

function researchSentence(stats: ResearchStats): string {
  if (!stats.firecrawlReady) return 'Web search is not set up yet.'
  if (stats.sessions === 0) return 'No searches yet.'
  const unattached =
    stats.unattachedSnippets > 0 ? `; ${pluralizeWithCount(stats.unattachedSnippets, 'finding')} not attached to a bug yet` : ''
  return `${pluralizeWithCount(stats.sessions, 'search', 'searches')}, ${pluralizeWithCount(stats.snippets, 'finding')} saved${unattached}.`
}

export function ResearchSnapshotStrip({ stats, statsFetchedAt, statsValidating, statLabels, onSearch }: Props) {
  return (
    <PageStatus
      ariaLabel="Research status"
      tone={!stats.firecrawlReady ? 'warn' : stats.unattachedSnippets > 0 ? 'info' : 'ok'}
      sentence={researchSentence(stats)}
      freshness={{ at: statsFetchedAt, isValidating: statsValidating }}
      metrics={[
        {
          label: statLabels?.sessions ?? 'Searches',
          value: stats.sessions,
          hint: 'Web searches run from this page or from a bug.',
          to: researchLinks.sessions,
        },
        {
          label: statLabels?.attached ?? 'Attached to a bug',
          value: stats.attached,
          hint: 'Findings saved on a bug, where its diagnosis and fix can use them.',
          to: researchLinks.attached,
        },
        {
          label: statLabels?.unattached ?? 'Not attached',
          value: stats.unattachedSnippets,
          tone: stats.unattachedSnippets > 0 ? 'warn' : 'neutral',
          hint: 'Saved findings no bug uses yet.',
          to: researchLinks.unattached,
        },
      ]}
      empty={
        stats.firecrawlReady
          ? {
              title: 'No searches yet',
              sentence: 'Search the web for an error message to see whether others hit it and how they fixed it.',
              action: onSearch ? { label: 'Run first search', onClick: onSearch } : { label: 'Run first search', to: '/research?tab=search' },
            }
          : undefined
      }
    />
  )
}
