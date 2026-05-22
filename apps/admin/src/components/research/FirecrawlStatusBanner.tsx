/**
 * FILE: apps/admin/src/components/research/FirecrawlStatusBanner.tsx
 * PURPOSE: Surface Firecrawl BYOK readiness so operators know why search works or not.
 */

import { Link } from 'react-router-dom'
import { Btn, Badge } from '../ui'
import { StatusBannerShell } from '../StatusBannerShell'
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
      <StatusBannerShell
        tone="warn"
        title="Firecrawl not configured"
        subtitle={
          projectName
            ? `Web search for ${projectName} requires a BYOK Firecrawl key in Settings.`
            : 'Add a Firecrawl API key before running web research.'
        }
        action={
          <Link to="/settings?tab=firecrawl">
            <Btn size="sm" variant="primary">Configure Firecrawl</Btn>
          </Link>
        }
      />
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
      <StatusBannerShell
        tone="danger"
        title={label}
        subtitle={`Key ${config.keyHint ?? 'configured'} — re-test in Settings → Firecrawl before searching.`}
        action={
          <Link to="/settings?tab=firecrawl">
            <Btn size="sm" variant="ghost">Fix in Settings</Btn>
          </Link>
        }
      />
    )
  }

  return (
    <StatusBannerShell
      tone="ok"
      title="Firecrawl ready"
      subtitle={
        <>
          <Badge className="bg-surface-raised font-mono text-fg-secondary">{config.keyHint ?? 'key set'}</Badge>
          {config.allowedDomains.length > 0 && (
            <span className="ml-2">
              {config.allowedDomains.length} allowed domain{config.allowedDomains.length === 1 ? '' : 's'}
            </span>
          )}
          <span className="ml-1">· up to {config.maxPagesPerCall} pages/call</span>
        </>
      }
      action={
        <Link to="/settings?tab=firecrawl">
          <Btn size="sm" variant="ghost">Settings</Btn>
        </Link>
      }
    />
  )
}
