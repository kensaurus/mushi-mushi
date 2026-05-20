/**
 * FILE: apps/admin/src/components/integrations/IntegrationStatusBanner.tsx
 * PURPOSE: Top-level integration health summary for the active project.
 */

import { Link } from 'react-router-dom'
import { Btn } from '../ui'
import type { IntegrationStats } from './types'

interface Props {
  stats: IntegrationStats
  projectName: string | null
  disconnectedPlatformCount: number
}

export function IntegrationStatusBanner({
  stats,
  projectName,
  disconnectedPlatformCount,
}: Props) {
  if (stats.platformDown > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-xs font-medium text-danger">
              {stats.platformDown} platform probe{stats.platformDown === 1 ? '' : 's'} failing
            </p>
            <p className="text-2xs text-fg-muted">
              The LLM pipeline and fix-worker degrade without healthy Sentry, Langfuse, or GitHub wiring.
            </p>
          </div>
        </div>
        <Link to="/health?fn=integration-probe">
          <Btn size="sm" variant="ghost">Open health</Btn>
        </Link>
      </div>
    )
  }

  if (disconnectedPlatformCount > 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden />
          <div>
            <p className="text-xs font-medium text-warn">
              {disconnectedPlatformCount} platform integration{disconnectedPlatformCount === 1 ? '' : 's'} incomplete
            </p>
            <p className="text-2xs text-fg-muted">
              {projectName
                ? `Finish credentials for ${projectName} on the cards below, then click Test on each.`
                : 'Add credentials on each platform card, then click Test to probe live.'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (stats.platformConnected === 0 && stats.routingActive === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden />
          <div>
            <p className="text-xs font-medium text-info">
              {projectName ? `No integrations wired for ${projectName}` : 'No integrations wired yet'}
            </p>
            <p className="text-2xs text-fg-muted">
              Start with GitHub (code repo) for auto-fix PRs, Langfuse for trace links, and Sentry for production context.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 min-w-0">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
        <div>
          <p className="text-xs font-medium text-ok">Integrations healthy</p>
          <p className="text-2xs text-fg-muted">
            {stats.platformConnected}/{stats.platformTotal} platform · {stats.routingActive} routing destination
            {stats.routingActive === 1 ? '' : 's'} active
            {projectName ? ` · ${projectName}` : ''}
          </p>
        </div>
      </div>
      {stats.lastProbeAt && (
        <span className="font-mono text-3xs text-fg-faint shrink-0">
          Last probe recorded
        </span>
      )}
    </div>
  )
}
