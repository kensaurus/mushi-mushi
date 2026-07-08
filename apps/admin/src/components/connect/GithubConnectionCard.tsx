/**
 * GitHub repository connection status for /connect — preflight-backed.
 */

import { Link } from 'react-router-dom'
import { Card, Btn } from '../ui'
import { JobStatusPill } from '../ui/job-status-pill'
import { CHIP_TONE } from '../../lib/chipTone'
import type { PreflightState } from '../../lib/useDispatchPreflight'
import { IconGit, IconCheck, IconArrowRight, IconIntegrations } from '../icons'

interface GithubConnectionCardProps {
  preflight: PreflightState
  fallbackRepoUrl: string | null
}

export function GithubConnectionCard({
  preflight,
  fallbackRepoUrl,
}: GithubConnectionCardProps) {
  const githubCheck = preflight.checks.find((c) => c.key === 'github')
  const repoUrl = preflight.repoUrl ?? fallbackRepoUrl
  const hasGithub = Boolean(repoUrl) && (githubCheck?.ready ?? Boolean(repoUrl))
  const loading = preflight.loading && !repoUrl

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <IconGit className="h-5 w-5 text-fg-muted shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">GitHub repository</p>
          {loading ? (
            <p className="text-xs text-fg-muted" aria-busy="true">Checking connection…</p>
          ) : hasGithub && repoUrl ? (
            <p className="text-xs text-fg-muted font-mono break-all">{repoUrl}</p>
          ) : (
            <p className="text-xs text-fg-muted">
              {githubCheck?.hint ??
                'Required for upgrade PRs and autofix. Managed in Integrations.'}
            </p>
          )}
        </div>
        {loading ? (
          <JobStatusPill status="running" runningLabel="Loading" />
        ) : hasGithub ? (
          <span className={`inline-flex items-center gap-1 text-xs shrink-0 rounded-full px-2 py-0.5 ${CHIP_TONE.okSubtle}`}>
            <IconCheck className="h-3.5 w-3.5" aria-hidden />
            Connected
          </span>
        ) : (
          <Link to={githubCheck?.fixHref ?? '/integrations/config'}>
            <Btn size="sm" variant="ghost" className="gap-1.5 shrink-0">
              <IconIntegrations className="h-3.5 w-3.5" aria-hidden />
              Set up in Integrations
              <IconArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Btn>
          </Link>
        )}
      </div>
    </Card>
  )
}
