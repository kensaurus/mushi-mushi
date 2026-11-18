/**
 * FILE: RepoProvenanceReadout.tsx
 * PURPOSE: Repo hub provenance — primary GitHub URL and branch/PR signals.
 */

import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection, ReadoutPanel } from '../readout'
import type { RepoStats } from './RepoStatsTypes'
import { IconGit, IconGlobe, IconHealth } from '../icons'

export interface RepoProvenanceReadoutProps {
  stats: RepoStats
  repoUrl: string | null
  fetchedAt: string | null
  validating?: boolean
}

// fetchedAt/validating stay in the props for callers; "Updated" is shown once, in the status line.
export function RepoProvenanceReadout({
  stats,
  repoUrl,
}: RepoProvenanceReadoutProps) {
  if (!stats.projectId || !repoUrl) return null

  const rows: DetailRowItem[] = [
    // Open PRs, merged and failing CI are in the page status line; not repeated here.
    {
      label: 'Stuck fixes',
      value: String(stats.failedToOpen),
      tone: stats.failedToOpen > 0 ? 'warn' : 'muted',
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
    <ReadoutPanel title="Repo readout">
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
    </ReadoutPanel>
  )
}
