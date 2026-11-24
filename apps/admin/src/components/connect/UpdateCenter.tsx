/**
 * Update center — SDK versions and the one upgrade action for /connect.
 *
 * Every line here comes from real state (see lib/updateCenterView.ts): the
 * version your app reports vs the latest release, and the latest upgrade job.
 * When the app is current there is no upgrade button; when an upgrade PR is
 * already open it is shown with its CI state instead of offering a new one.
 */

import { Link } from 'react-router-dom'
import { Btn, Tooltip, CopyButton, HelpBanner } from '../ui'
import { JobStatusPill } from '../ui/job-status-pill'
import { BumpPlanTable } from './BumpPlanTable'
import { useSdkUpgrade } from '../../lib/useSdkUpgrade'
import type { PreflightState } from '../../lib/useDispatchPreflight'
import { CodeInline } from '../CodePanel'
import { LockfileHelperDisclosure } from '../SdkUpgradeCTA'
import { LINK_ACCENT } from '../../lib/chipTone'
import { StatusPill, type RunStatus } from '../signal/StatusMark'
import { deriveUpdateCenterView, type UpdateCenterView } from '../../lib/updateCenterView'
import type { SdkStatus } from '../SdkVersionBadge'
import {
  IconGit,
  IconExternalLink,
  IconRefresh,
  IconBolt,
  IconAlertTriangle,
  IconArrowRight,
} from '../icons'

interface UpdateCenterProject {
  id: string
  sdk_package?: string | null
  sdk_version?: string | null
  sdk_latest_version?: string | null
  sdk_status?: SdkStatus | null
}

interface UpdateCenterProps {
  project: UpdateCenterProject
  preflight: PreflightState
}


function prNumberFrom(url: string | undefined): string | null {
  const m = url?.match(/\/pull\/(\d+)/)
  return m ? `#${m[1]}` : null
}

function VersionTable({ view }: { view: UpdateCenterView }) {
  if (view.packages.length === 0) {
    return (
      <p className="text-xs text-fg-muted">
        Not checked yet — no app has reported its Mushi Mushi SDK version. It shows up after your app
        checks in or sends its first report.
      </p>
    )
  }
  // The package name stays on one line ("@mushi-/mushi/web" broke at its hyphen on a phone); a
  // narrow screen scrolls the table inside its own box, never the page (round-3 review).
  return (
    <div className="overflow-x-auto">
    <table className="w-full text-xs" aria-label="Installed and latest SDK versions">
      <thead>
        <tr className="text-left text-fg-muted">
          <th className="py-1 pr-3 font-medium">Package</th>
          <th className="py-1 pr-3 font-medium">In your app</th>
          <th className="py-1 pr-3 font-medium">Latest</th>
          <th className="py-1 font-medium"><span className="sr-only">Status</span></th>
        </tr>
      </thead>
      <tbody>
        {view.packages.map((p) => (
          <tr key={p.package} className="border-t border-edge-subtle">
            <td className="py-1.5 pr-3 font-mono whitespace-nowrap">{p.package}</td>
            <td className="py-1.5 pr-3 font-mono">{p.installed ?? 'not checked yet'}</td>
            <td className="py-1.5 pr-3 font-mono">{p.latest ?? 'not checked yet'}</td>
            <td className="py-1.5">
              {p.current === true ? (
                <StatusPill status="passed" label="Up to date" />
              ) : p.current === false ? (
                <StatusPill status="slow" label="Update available" />
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )
}

function checkedAgo(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  return s < 60 ? 'just now' : `${Math.round(s / 60)} min ago`
}

const CI_CHIP: Record<UpdateCenterView['ci'], { label: string; status: RunStatus }> = {
  passing: { label: 'CI passing', status: 'passed' },
  failing: { label: 'CI failing', status: 'failed' },
  running: { label: 'CI running', status: 'running' },
  not_checked: { label: 'CI not checked yet', status: 'idle' },
}

export function UpdateCenter({ project, preflight }: UpdateCenterProps) {
  const { state, createUpgradePr, refreshUpgradePr, syncStatus } = useSdkUpgrade(project.id)
  const view = deriveUpdateCenterView(project, state)

  const isInFlight = ['queueing', 'queued', 'running', 'awaiting_lockfile'].includes(state.status)
  const githubCheck = preflight.checks.find((c) => c.key === 'github')
  const hasRepoRow = Boolean(preflight.repoUrl)
  // Unknown is not "not ready": while the preflight loads, the banner used to
  // claim GitHub was disconnected on a project with a working App install.
  const hasGithubReady = githubCheck ? githubCheck.ready : preflight.loading || hasRepoRow
  const githubHint = githubCheck && !githubCheck.ready ? githubCheck.hint : null
  const prLabel = prNumberFrom(state.prUrl) ?? 'Upgrade PR'
  const ci = CI_CHIP[view.ci]

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-fg">SDK version</h3>
        <p className="text-xs text-fg-muted mt-0.5 mb-2">
          The version your app reports vs. the latest published release.
        </p>
        <VersionTable view={view} />
      </div>

      {/* Nothing to upgrade until the app reports an SDK version: a brand-new app opened Connect
          on a yellow "GitHub not ready for upgrade PRs" (fresh-account walk, 2026-11-24). */}
      {!hasGithubReady && Boolean(project.sdk_version) && (
        <HelpBanner
          tone="warn"
          title="GitHub not ready for upgrade PRs"
          icon={<IconAlertTriangle className="h-4 w-4 text-warn-foreground" />}
        >
          {githubHint ?? (
            <>
              Connect a GitHub repo in{' '}
              <Link to="/integrations/config#platform-card-github" className="underline focus-visible:ring-2 focus-visible:ring-focus">
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

      {/* State line — one sentence about where the upgrade stands. "Up to
          date" needs none: each version row already carries that mark. */}
      {view.mode === 'repo_current' && (
        <p className="text-xs text-fg-muted">
          {state.error ?? 'Your repo already uses the latest @mushi-mushi/* versions.'}
          {view.packages[0]?.current === false
            ? ' Your app still reports an older version — ship a new build to roll it out.'
            : ''}
        </p>
      )}
      {view.mode === 'awaiting_lockfile' && (
        <p className="text-xs text-fg-muted">
          The version bump is pushed. Your Mushi lockfile workflow is refreshing the lockfile; the
          upgrade PR opens on its own within about 30 minutes.
        </p>
      )}
      {view.mode === 'pr_open' && state.prUrl && (
        <div className="space-y-1.5">
          <p className="flex flex-wrap items-center gap-2 text-xs text-fg">
            <span className="font-medium">
              Upgrade PR {prLabel} is open
              {view.prTargetVersion ? ` (to ${view.prTargetVersion})` : ''}.
            </span>
            <StatusPill status={ci.status} label={ci.label} />
          </p>
          <p className="text-2xs text-fg-muted">
            Review and merge it on GitHub. Lockfile: your Mushi lockfile workflow refreshes it on
            the PR branch; without one, run your package manager after merging.
          </p>
        </div>
      )}
      {view.mode === 'pr_merged' && (
        <p className="text-xs text-fg">
          Upgrade PR {prLabel} merged
          {view.prTargetVersion ? ` (to ${view.prTargetVersion})` : ''}.{' '}
          {view.appBehindPr
            ? `Your app still reports ${view.packages[0]?.installed ?? 'an older version'} — ship a new build to roll it out.`
            : view.packages[0]?.installed
              ? `Your app runs ${view.packages[0].installed}.`
              : ''}
          {view.newerThanPr ? ` A newer release (${view.packages[0]?.latest}) is out since.` : ''}
        </p>
      )}
      {state.syncError && (
        <p className="text-xs text-danger-foreground" role="status">{state.syncError}</p>
      )}
      {!state.syncError && state.checkedAt && !state.syncing ? (
        <p className="text-xs text-fg-muted" role="status" data-testid="update-center-ci-checked">
          Checked {checkedAgo(state.checkedAt)}: {ci.label}.
          {view.ci === 'failing' && state.workflowUrl ? (
            <>
              {' '}
              <a href={state.workflowUrl} target="_blank" rel="noopener noreferrer" className={LINK_ACCENT}>
                See the failing run
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      {view.mode === 'failed' && state.error && (
        <p className="text-xs text-danger-foreground">{state.error}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {hasGithubReady ? (
          <>
            {(view.mode === 'pr_open' || view.mode === 'pr_merged') && state.prUrl ? (
              <Btn
                size="sm"
                variant={view.mode === 'pr_open' ? 'primary' : 'ghost'}
                className="gap-2"
                href={state.prUrl}
              >
                <IconExternalLink className="h-3.5 w-3.5" aria-hidden />
                View PR {prNumberFrom(state.prUrl) ?? ''}
              </Btn>
            ) : null}
            {view.mode === 'pr_open' && view.newerThanPr ? (
              <Tooltip content="Move the open PR to the newest release." side="top">
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={isInFlight}
                  onClick={() => void refreshUpgradePr()}
                  className="gap-2"
                >
                  <IconRefresh className="h-3.5 w-3.5" aria-hidden />
                  Update PR to {view.packages[0]?.latest}
                </Btn>
              </Tooltip>
            ) : null}
            {(view.mode === 'pr_open' || view.mode === 'pr_merged') && state.jobId ? (
              <Btn
                size="sm"
                variant="ghost"
                disabled={isInFlight || state.syncing}
                loading={state.syncing}
                onClick={() => void syncStatus(state.jobId!)}
                className="gap-2"
                data-testid="update-center-check-ci"
              >
                Check CI status
              </Btn>
            ) : null}
            {view.upgradeLabel ? (
              <Btn
                size="sm"
                variant="primary"
                loading={isInFlight}
                disabled={isInFlight}
                onClick={() => void createUpgradePr()}
                className="gap-2"
              >
                <IconBolt className="h-3.5 w-3.5" aria-hidden />
                {view.upgradeLabel}
              </Btn>
            ) : null}
            {view.mode === 'failed' ? (
              <Btn
                size="sm"
                variant="primary"
                onClick={() => void refreshUpgradePr()}
                className="gap-2"
              >
                <IconRefresh className="h-3.5 w-3.5" aria-hidden />
                Try the upgrade again
              </Btn>
            ) : null}
            {view.mode === 'not_checked' || view.mode === 'repo_current' || view.mode === 'up_to_date' ? (
              <Tooltip content="Scan your repo's package.json files for older @mushi-mushi/* versions." side="top">
                <Btn
                  size="sm"
                  variant="ghost"
                  loading={isInFlight}
                  disabled={isInFlight}
                  onClick={() => void createUpgradePr()}
                  className="gap-2"
                >
                  <IconRefresh className="h-3.5 w-3.5" aria-hidden />
                  {view.mode === 'not_checked' ? 'Check my repo' : 'Check again'}
                </Btn>
              </Tooltip>
            ) : null}
          </>
        ) : (
          <Btn to="/connect#connect-github" size="sm" variant="ghost" className="gap-2">
            <IconGit className="h-3.5 w-3.5" aria-hidden />
            Connect GitHub
            <IconArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Btn>
        )}

        {/* A bare copy icon beside "Check again" named nothing (round-3 review, 2026-11-19). */}
        <span className="inline-flex items-center gap-1 text-2xs text-fg-muted">
          or run <code className="font-mono text-fg-secondary">mushi upgrade</code>
          <CopyButton value="mushi upgrade" label="Copy CLI command" copiedLabel="Copied" size="sm" />
        </span>

        {view.mode === 'working' || view.mode === 'awaiting_lockfile' ? (
          <JobStatusPill status={state.status} prUrl={state.prUrl} error={state.error} />
        ) : null}
      </div>

      {state.plan && state.plan.length > 0 && view.mode !== 'up_to_date' && (
        <div>
          <p className="text-2xs text-fg-muted mb-1">What the upgrade PR changes in your repo</p>
          <BumpPlanTable bumps={state.plan} />
        </div>
      )}

      {view.mode === 'pr_open' && state.reused && (
        <p className="text-xs text-fg-muted">
          Reused the existing open upgrade PR for this repo — no duplicate branch was created.
          Capacitor/RN projects also need <CodeInline>npx cap sync</CodeInline>.
        </p>
      )}

      {hasGithubReady && <LockfileHelperDisclosure />}
    </div>
  )
}
