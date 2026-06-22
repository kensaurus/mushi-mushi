/**
 * FILE: RepoProvenanceReadout.tsx
 * PURPOSE: Repo hub provenance — primary GitHub URL and branch/PR signals.
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import type { RepoStats } from './RepoStatsTypes'
import { IconGit, IconGlobe, IconHealth } from '../icons'

export interface RepoProvenanceReadoutProps {
  stats: RepoStats
  repoUrl: string | null
  fetchedAt: string | null
  validating?: boolean
}

export function RepoProvenanceReadout({
  stats,
  repoUrl,
  fetchedAt,
  validating,
}: RepoProvenanceReadoutProps) {
  if (!stats.projectId || !repoUrl) return null

  const rows: DetailRowItem[] = [
    {
      label: 'Open PRs',
      value: String(stats.prOpen),
      tone: stats.prOpen > 0 ? 'info' : 'muted',
    },
    {
      label: 'Merged',
      value: String(stats.merged),
      tone: stats.merged > 0 ? 'ok' : 'muted',
    },
    {
      label: 'CI failing',
      value: String(stats.ciFailed),
      tone: stats.ciFailed > 0 ? 'danger' : 'ok',
    },
    {
      label: 'Stuck fixes',
      value: String(stats.failedToOpen),
      tone: stats.failedToOpen > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Project ref',
      value: stats.projectId,
      mono: true,
      copyable: true,
      wrap: true,
    },
  ]

  return (
    <Section title="Repo readout" freshness={{ at: fetchedAt, isValidating: validating }}>
      <p className="mb-4 text-xs leading-relaxed text-fg-muted">
        Primary connected repository and fix-worker branch posture — copy the repo URL for support tickets or CI wiring.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Repository" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="GitHub repo" url={repoUrl} />
        </ReadoutSection>
        <ReadoutSection title="Live signals" icon={<IconHealth size={14} aria-hidden />}>
          <DetailRows items={rows} dense />
          <div className="mt-2 flex flex-wrap gap-2 text-3xs text-fg-faint">
            <span className="inline-flex items-center gap-1 rounded-full border border-edge-subtle px-2 py-0.5">
              <IconGit size={12} aria-hidden />
              Branches tab for PR graph
            </span>
          </div>
        </ReadoutSection>
      </div>
    </Section>
  )
}
