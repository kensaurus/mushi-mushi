/**
 * FILE: apps/admin/src/components/storage/StorageStatusBanner.tsx
 * PURPOSE: BYO bucket health — probe status, defaults, and upload risk.
 */

import { Link } from 'react-router-dom'
import { Btn, RelativeTime } from '../ui'
import type { StorageStats, StorageTabId } from './types'

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
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">No project selected</p>
            <p className="text-2xs text-fg-muted">
              Storage backends are per-project — pick an app in the header switcher before configuring a bucket.
            </p>
          </div>
        </div>
        <Link to="/projects">
          <Btn size="sm" variant="ghost">Go to Projects</Btn>
        </Link>
      </div>
    )
  }

  if (stats.activeProjectHealthStatus === 'failing') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">Bucket probe failing for {projectLabel}</p>
            <p className="text-2xs text-fg-muted break-words">
              {stats.latestFailureError?.slice(0, 160) ?? 'Screenshot uploads may fail silently — rotate Vault credentials or fix the bucket path.'}
            </p>
          </div>
        </div>
        {onHealthCheck ? (
          <Btn size="sm" variant="ghost" onClick={onHealthCheck} loading={checking} disabled={checking}>
            Re-run probe
          </Btn>
        ) : onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('configure')}>
            Fix config
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.activeProjectHealthStatus === 'degraded') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">Bucket health degraded on {projectLabel}</p>
            <p className="text-2xs text-fg-muted">
              Uploads still work but recent probes reported errors — run a health check before the next report spike.
            </p>
          </div>
        </div>
        {onHealthCheck ? (
          <Btn size="sm" variant="ghost" onClick={onHealthCheck} loading={checking} disabled={checking}>
            Health check
          </Btn>
        ) : null}
      </div>
    )
  }

  if (!stats.activeProjectConfigured) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">Using cluster default storage</p>
            <p className="text-2xs text-fg-muted">
              {projectLabel} uploads to Supabase Storage until you save a BYO bucket override on Configure.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('configure')}>
            Configure bucket
          </Btn>
        ) : null}
      </div>
    )
  }

  if (!stats.lastHealthCheckAt) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">Bucket saved — never probed</p>
            <p className="text-2xs text-fg-muted">
              Run a health check on {projectLabel} ({stats.activeProjectProvider}) before routing production uploads.
            </p>
          </div>
        </div>
        {onHealthCheck ? (
          <Btn size="sm" variant="ghost" onClick={onHealthCheck} loading={checking} disabled={checking}>
            Run probe
          </Btn>
        ) : null}
      </div>
    )
  }

  if (stats.failingCount > 0 && stats.activeProjectHealthStatus === 'healthy') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {stats.failingCount} other project bucket{stats.failingCount === 1 ? '' : 's'} failing
            </p>
            <p className="text-2xs text-fg-muted">
              {projectLabel} is healthy — switch projects in the header to fix sibling buckets.
            </p>
          </div>
        </div>
        {onTab ? (
          <Btn size="sm" variant="ghost" onClick={() => onTab('configure')}>
            View all buckets
          </Btn>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">
            {stats.activeProjectProvider} bucket healthy for {projectLabel}
          </p>
          <p className="text-2xs text-fg-muted">
            {stats.activeProjectObjects.toLocaleString()} screenshot{stats.activeProjectObjects === 1 ? '' : 's'}
            {stats.lastHealthCheckAt ? (
              <> · probed <RelativeTime value={stats.lastHealthCheckAt} /></>
            ) : null}
          </p>
        </div>
      </div>
      {onTab ? (
        <Btn size="sm" variant="ghost" onClick={() => onTab('usage')}>
          View usage
        </Btn>
      ) : null}
    </div>
  )
}

