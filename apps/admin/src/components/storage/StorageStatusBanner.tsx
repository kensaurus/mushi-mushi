/**
 * FILE: apps/admin/src/components/storage/StorageStatusBanner.tsx
 * PURPOSE: BYO bucket health — probe status, defaults, and upload risk.
 */

import { Btn } from '../ui'
import { StatusBannerShell } from '../StatusBannerShell'
import type { StorageStats, StorageTabId } from './types'

/**
 * Whether the status banner shows. A healthy bucket is covered by the page
 * hero + snapshot. The cluster-default state is shown: it says where
 * screenshots go and how to change it (that branch used to be unreachable).
 */
export function isStorageStatusBannerCritical(stats: StorageStats): boolean {
  if (!stats.projectId) return true
  if (!stats.activeProjectConfigured) return true
  if (stats.activeProjectHealthStatus === 'failing') return true
  if (stats.activeProjectHealthStatus === 'degraded') return true
  if (!stats.lastHealthCheckAt && stats.activeProjectConfigured) return true
  if (stats.failingCount > 0 && stats.activeProjectHealthStatus === 'healthy') return true
  return false
}

interface Props {
  stats: StorageStats
  onTab?: (tab: StorageTabId) => void
  onHealthCheck?: () => void
  checking?: boolean
}

export function StorageStatusBanner({ stats, onTab, onHealthCheck, checking }: Props) {
  const projectLabel = stats.projectName ?? 'active project'

  if (!stats.projectId) {
    return (
      <StatusBannerShell
        tone="warn"
        title="No project selected"
        subtitle="Storage backends are per-project — pick an app in the header switcher before configuring a bucket."
        action={
          <Btn to="/projects" size="sm" variant="ghost">Go to Projects</Btn>
        }
      />
    )
  }

  if (stats.activeProjectHealthStatus === 'failing') {
    return (
      <StatusBannerShell
        tone="danger"
        title={`Bucket probe failing for ${projectLabel}`}
        subtitle={
          <span className="break-words">
            {stats.latestFailureError?.slice(0, 160) ?? 'Screenshot uploads may fail silently — rotate Vault credentials or fix the bucket path.'}
          </span>
        }
        action={
          onHealthCheck ? (
            <Btn size="sm" variant="ghost" onClick={onHealthCheck} loading={checking} disabled={checking}>
              Re-run probe
            </Btn>
          ) : onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('configure')}>
              Fix config
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.activeProjectHealthStatus === 'degraded') {
    return (
      <StatusBannerShell
        tone="warn"
        title={`Bucket health degraded on ${projectLabel}`}
        subtitle="Uploads still work but recent probes reported errors — run a health check before the next report spike."
        action={
          onHealthCheck ? (
            <Btn size="sm" variant="ghost" onClick={onHealthCheck} loading={checking} disabled={checking}>
              Health check
            </Btn>
          ) : null
        }
      />
    )
  }

  if (!stats.activeProjectConfigured) {
    return (
      <StatusBannerShell
        tone="info"
        title="Using cluster default storage"
        subtitle={`${projectLabel} uploads to Supabase Storage until you save a BYO bucket override on Configure.`}
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('configure')}>
              Configure bucket
            </Btn>
          ) : null
        }
      />
    )
  }

  if (!stats.lastHealthCheckAt) {
    return (
      <StatusBannerShell
        tone="info"
        title="Bucket saved — never probed"
        subtitle={`Run a health check on ${projectLabel} (${stats.activeProjectProvider}) before routing production uploads.`}
        action={
          onHealthCheck ? (
            <Btn size="sm" variant="ghost" onClick={onHealthCheck} loading={checking} disabled={checking}>
              Run probe
            </Btn>
          ) : null
        }
      />
    )
  }

  if (stats.failingCount > 0 && stats.activeProjectHealthStatus === 'healthy') {
    return (
      <StatusBannerShell
        tone="warn"
        title={`${stats.failingCount} other project bucket${stats.failingCount === 1 ? '' : 's'} failing`}
        subtitle={`${projectLabel} is healthy — switch projects in the header to fix sibling buckets.`}
        action={
          onTab ? (
            <Btn size="sm" variant="ghost" onClick={() => onTab('configure')}>
              View all buckets
            </Btn>
          ) : null
        }
      />
    )
  }

  // Healthy: the page hero and snapshot already say so
  // (isStorageStatusBannerCritical keeps the banner hidden).
  return null
}
