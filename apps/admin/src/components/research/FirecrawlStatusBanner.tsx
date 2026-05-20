/**
 * FILE: apps/admin/src/components/research/FirecrawlStatusBanner.tsx
 * PURPOSE: Surface Firecrawl BYOK readiness so operators know why search works or not.
 */

import { Link } from 'react-router-dom'
import { Btn, Badge } from '../ui'
import type { FirecrawlConfig } from './types'

interface Props {
  config: FirecrawlConfig | null
  loading?: boolean
  projectName: string | null
}

export function FirecrawlStatusBanner({ config, loading, projectName }: Props) {
  if (loading) return null

  if (!config?.configured) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">Firecrawl not configured</p>
            <p className="text-2xs text-fg-muted">
              {projectName
                ? `Web search for ${projectName} requires a BYOK Firecrawl key in Settings.`
                : 'Add a Firecrawl API key before running web research.'}
            </p>
          </div>
        </div>
        <Link to="/settings?tab=firecrawl">
          <Btn size="sm" variant="primary">Configure Firecrawl</Btn>
        </Link>
      </div>
    )
  }

  if (config.testStatus && config.testStatus !== 'ok') {
    const label =
      config.testStatus === 'error_auth'
        ? 'Firecrawl auth failed'
        : config.testStatus === 'error_quota'
          ? 'Firecrawl quota / rate limit'
          : 'Firecrawl connection error'
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">{label}</p>
            <p className="text-2xs text-fg-muted">
              Key {config.keyHint ?? 'configured'} — re-test in Settings → Firecrawl before searching.
            </p>
          </div>
        </div>
        <Link to="/settings?tab=firecrawl">
          <Btn size="sm" variant="ghost">Fix in Settings</Btn>
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <span className="h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <p className="text-xs font-medium text-ok">Firecrawl ready</p>
        <Badge className="bg-surface-raised font-mono text-fg-secondary">{config.keyHint ?? 'key set'}</Badge>
        {config.allowedDomains.length > 0 && (
          <span className="text-2xs text-fg-muted">
            {config.allowedDomains.length} allowed domain{config.allowedDomains.length === 1 ? '' : 's'}
          </span>
        )}
        <span className="text-2xs text-fg-faint">· up to {config.maxPagesPerCall} pages/call</span>
      </div>
      <Link to="/settings?tab=firecrawl">
        <Btn size="sm" variant="ghost">Settings</Btn>
      </Link>
    </div>
  )
}
