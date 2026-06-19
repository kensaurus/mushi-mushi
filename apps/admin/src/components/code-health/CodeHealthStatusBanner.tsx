/**
 * Code health posture banner — CI ingest, errors, warnings, healthy.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import { StatusBannerShell } from '../StatusBannerShell'
import type { CodeHealthStats } from './CodeHealthStatsTypes'

interface Props {
  stats: CodeHealthStats
  onRefresh?: () => void
  refreshing?: boolean
}

export function CodeHealthStatusBanner({ stats, onRefresh, refreshing }: Props) {
  const projectLabel = stats.projectName ?? 'active project'
  const label = stats.topPriorityLabel
  const to = stats.topPriorityTo

  if (!stats.hasAnyProject) {
    return (
      <StatusBannerShell
        tone="info"
        title="Pick a project first"
        subtitle="Code health metrics are per app — choose one in the header switcher."
        action={
          <Link to="/projects">
            <Btn size="sm" variant="ghost">Go to Projects</Btn>
          </Link>
        }
      />
    )
  }

  if (stats.topPriority === 'no_data') {
    return (
      <StatusBannerShell
        tone="brand"
        title="No CI data yet"
        subtitle={
          label ??
          `Wire MUSHI_INGEST_KEY in ${projectLabel}'s GitHub Actions — bundle and god-file findings appear after the next push to main.`
        }
        action={
          to ? (
            <Link to={to}>
              <Btn size="sm" variant="primary">Set up CI ingest</Btn>
            </Link>
          ) : (
            <Link to="/connect">
              <Btn size="sm" variant="primary">Open Connect</Btn>
            </Link>
          )
        }
      />
    )
  }

  if (stats.topPriority === 'errors') {
    return (
      <StatusBannerShell
        tone="danger"
        title={`${stats.errorCount} god-file error${stats.errorCount === 1 ? '' : 's'} on ${projectLabel}`}
        subtitle={label}
        action={onRefresh ? <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing}>Refresh</Btn> : null}
      />
    )
  }

  if (stats.topPriority === 'warnings') {
    return (
      <StatusBannerShell
        tone="warn"
        title={`${stats.warnCount} warning${stats.warnCount === 1 ? '' : 's'} — files approaching budget`}
        subtitle={label}
        action={onRefresh ? <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing}>Refresh</Btn> : null}
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title={`Code health looks good on ${projectLabel}`}
      subtitle={label}
      action={
        onRefresh ? (
          <Btn size="sm" variant="ghost" onClick={onRefresh} loading={refreshing} disabled={refreshing}>
            Refresh
          </Btn>
        ) : null
      }
    />
  )
}
