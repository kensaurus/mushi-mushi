/**
 * GitHub repository connection status for /connect — preflight-backed.
 * Lists every repo linked to the project (frontend, backend, ...) with its
 * role, so a split frontend/backend project reads as one app.
 */

import { Card, Btn, Badge } from '../ui'
import { JobStatusPill } from '../ui/job-status-pill'
import { CHIP_TONE } from '../../lib/chipTone'
import type { PreflightState } from '../../lib/useDispatchPreflight'
import { IconCheck, IconArrowRight, IconIntegrations } from '../icons'
import { BrandIcon } from '../ui/BrandIcon'
import { usePageData } from '../../lib/usePageData'
import { repoRoleMeta } from '../../lib/repoRoles'

/** The project_repos columns this card reads (GET /v1/admin/repo/repos). */
interface LinkedRepo {
  id: string
  repo_url: string
  role: string
  is_primary: boolean
}

interface GithubConnectionCardProps {
  projectId: string | null
  preflight: PreflightState
  fallbackRepoUrl: string | null
}

export function GithubConnectionCard({
  projectId,
  preflight,
  fallbackRepoUrl,
}: GithubConnectionCardProps) {
  const githubCheck = preflight.checks.find((c) => c.key === 'github')
  const { data: repoData } = usePageData<LinkedRepo[]>(
    projectId ? `/v1/admin/repo/repos?project_id=${encodeURIComponent(projectId)}` : null,
  )
  const linked = Array.isArray(repoData) ? repoData : []
  const repoUrl = preflight.repoUrl ?? fallbackRepoUrl ?? linked[0]?.repo_url ?? null
  const hasGithub = Boolean(repoUrl) && (githubCheck?.ready ?? Boolean(repoUrl))
  const loading = preflight.loading && !repoUrl

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <BrandIcon brand="github" size={20} decorative className="text-fg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">
            {linked.length > 1 ? `GitHub repositories (${linked.length})` : 'GitHub repository'}
          </p>
          {loading ? (
            <p className="text-xs text-fg-muted" aria-busy="true">Checking connection…</p>
          ) : linked.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {linked.map((repo) => {
                const { label, Icon, tone } = repoRoleMeta(repo.role)
                return (
                  <li key={repo.id} className="flex items-center gap-2 min-w-0">
                    <Badge tone={tone} className="text-3xs gap-1 shrink-0">
                      <Icon size={11} />
                      {label}
                    </Badge>
                    <span className="text-xs text-fg-muted font-mono truncate" title={repo.repo_url}>
                      {repo.repo_url.replace(/^https?:\/\/(www\.)?github\.com\//, '')}
                    </span>
                    {repo.is_primary && <span className="text-3xs text-fg-faint shrink-0">primary</span>}
                  </li>
                )
              })}
            </ul>
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
          <div className="flex items-center gap-2 shrink-0">
            <span className={`inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 ${CHIP_TONE.okSubtle}`}>
              <IconCheck className="h-3.5 w-3.5" aria-hidden />
              Connected
            </span>
            <Btn to="/repo" size="sm" variant="ghost" className="gap-1.5">
              {linked.length > 1 ? 'Manage repos' : 'Add a repo'}
              <IconArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Btn>
          </div>
        ) : (
          <Btn to={githubCheck?.fixHref ?? '/integrations/config'} size="sm" variant="ghost" className="gap-1.5 shrink-0">
              <IconIntegrations className="h-3.5 w-3.5" aria-hidden />
              Set up in Integrations
              <IconArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Btn>
        )}
      </div>
    </Card>
  )
}
