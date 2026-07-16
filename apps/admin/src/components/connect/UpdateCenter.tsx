/**
 * Update center — Create Upgrade PR flow for /connect.
 */

import { Link } from 'react-router-dom'
import { Btn, Tooltip, CopyButton, HelpBanner } from '../ui'
import { JobStatusPill } from '../ui/job-status-pill'
import { SdkVersionBadge, type SdkStatus } from '../SdkVersionBadge'
import { BumpPlanTable } from './BumpPlanTable'
import { useSdkUpgrade } from '../../lib/useSdkUpgrade'
import type { PreflightState } from '../../lib/useDispatchPreflight'
import { CodeInline } from '../CodePanel'
import {
  IconGit,
  IconExternalLink,
  IconRefresh,
  IconBolt,
  IconAlertTriangle,
  IconArrowRight,
} from '../icons'

export interface UpdateCenterProject {
  id: string
  sdk_package?: string | null
  sdk_version?: string | null
  sdk_latest_version?: string | null
  sdk_status?: SdkStatus | null
}

interface UpdateCenterProps {
  project: UpdateCenterProject
  preflight: PreflightState
  /** When true, hide redundant SdkVersionBadge (snapshot strip already shows version). */
  hideVersionBadge?: boolean
}

export function UpdateCenter({ project, preflight, hideVersionBadge = false }: UpdateCenterProps) {
  const { state, createUpgradePr, refreshUpgradePr, syncStatus } = useSdkUpgrade(project.id)

  const isInFlight = ['queueing', 'queued', 'running'].includes(state.status)
  const hasOpenPr = state.status === 'completed' && Boolean(state.prUrl)
  const isUpToDate = state.status === 'completed_no_pr'
  const isFailed = state.status === 'failed'
  const githubCheck = preflight.checks.find((c) => c.key === 'github')
  const hasRepoRow = Boolean(preflight.repoUrl)
  const hasGithubReady = githubCheck?.ready ?? hasRepoRow
  const githubHint = githubCheck && !githubCheck.ready ? githubCheck.hint : null

  const sdkStatus = (project.sdk_status ?? 'unknown') as SdkStatus

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-fg">SDK version</h3>
          <p className="text-xs text-fg-muted mt-0.5">
            Version seen in production reports vs. the latest published release.
          </p>
        </div>
        {!hideVersionBadge ? (
          <SdkVersionBadge
            status={sdkStatus}
            package_={project.sdk_package ?? null}
            observedVersion={project.sdk_version ?? null}
            latestVersion={project.sdk_latest_version ?? null}
          />
        ) : null}
      </div>

      {!hasGithubReady && (
        <HelpBanner
          tone="warn"
          title="GitHub not ready for upgrade PRs"
          icon={<IconAlertTriangle className="h-4 w-4 text-warning-foreground" />}
        >
          {githubHint ?? (
            <>
              Connect a GitHub repo in{' '}
              <Link to="/integrations/config" className="underline focus-visible:ring-2 focus-visible:ring-focus">
                Integrations
              </Link>{' '}
              to enable one-click upgrade PRs.
            </>
          )}
          {githubCheck?.fixHref && (
            <Link
              to={githubCheck.fixHref}
              className="mt-1 inline-flex text-xs font-medium text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity focus-visible:ring-2 focus-visible:ring-focus"
            >
              Fix GitHub connection
            </Link>
          )}
        </HelpBanner>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {hasGithubReady ? (
          <>
            {hasOpenPr && state.prUrl ? (
              <>
                <a href={state.prUrl} target="_blank" rel="noopener noreferrer">
                  <Btn size="md" variant="primary" className="gap-2">
                    <IconExternalLink className="h-4 w-4" aria-hidden />
                    View upgrade PR
                  </Btn>
                </a>
                <Tooltip
                  content="Refresh the open PR branch if newer @mushi-mushi/* versions shipped since it was opened."
                  side="top"
                >
                  <Btn
                    size="md"
                    variant="ghost"
                    loading={isInFlight}
                    disabled={isInFlight}
                    onClick={() => void refreshUpgradePr()}
                    className="gap-2"
                  >
                    <IconRefresh className="h-4 w-4" aria-hidden />
                    Refresh PR
                  </Btn>
                </Tooltip>
                {state.jobId && (
                  <Btn
                    size="md"
                    variant="ghost"
                    disabled={isInFlight}
                    onClick={() => void syncStatus(state.jobId!)}
                    className="gap-2"
                  >
                    Sync CI
                  </Btn>
                )}
              </>
            ) : isUpToDate ? (
              <Tooltip content="Re-scan the connected repo for newer catalog versions." side="top">
                <Btn
                  size="md"
                  variant="ghost"
                  loading={isInFlight}
                  disabled={isInFlight}
                  onClick={() => void createUpgradePr()}
                  className="gap-2"
                >
                  <IconRefresh className="h-4 w-4" aria-hidden />
                  Check again
                </Btn>
              </Tooltip>
            ) : (
              <Tooltip
                content={
                  isInFlight
                    ? 'Upgrade in progress…'
                    : isFailed
                      ? 'Retry opening or refreshing the upgrade PR.'
                      : 'Opens one upgrade PR per repo — reuses an existing open PR when present.'
                }
                side="top"
              >
                <Btn
                  size="md"
                  variant="primary"
                  loading={isInFlight}
                  disabled={isInFlight}
                  onClick={() => void (isFailed ? refreshUpgradePr() : createUpgradePr())}
                  className="gap-2"
                >
                  <IconBolt className="h-4 w-4" aria-hidden />
                  {isFailed ? 'Retry upgrade PR' : 'Create Upgrade PR'}
                </Btn>
              </Tooltip>
            )}
          </>
        ) : (
          <Link to="/integrations/config">
            <Btn size="md" variant="ghost" className="gap-2">
              <IconGit className="h-4 w-4" aria-hidden />
              Connect GitHub in Integrations
              <IconArrowRight className="h-4 w-4" aria-hidden />
            </Btn>
          </Link>
        )}

        <Tooltip content="Copy the mushi upgrade CLI command" side="top">
          <CopyButton value="mushi upgrade" label="Copy CLI command" copiedLabel="Copied" size="sm" />
        </Tooltip>

        <JobStatusPill status={state.status} prUrl={state.prUrl} error={state.error} />
      </div>

      {state.plan && state.plan.length > 0 && <BumpPlanTable bumps={state.plan} />}

      {state.status === 'completed_no_pr' && state.error && (
        <p className="text-xs text-fg-muted">{state.error}</p>
      )}

      {state.status === 'failed' && state.error && (
        <p className="text-xs text-danger-foreground">{state.error}</p>
      )}

      {state.status === 'completed' && state.prUrl && (
        <p className="text-xs text-fg-muted">
          {state.reused
            ? 'Reused the existing open upgrade PR for this repo — no duplicate branch was created.'
            : 'After merging the PR, run your package manager to refresh the lockfile.'}{' '}
          Capacitor/RN projects also need <CodeInline>npx cap sync</CodeInline>.
        </p>
      )}
    </div>
  )
}
