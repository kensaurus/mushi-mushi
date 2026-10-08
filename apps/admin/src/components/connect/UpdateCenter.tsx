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
import { CHIP_TONE } from '../../lib/chipTone'
import { deriveUpdateCenterView, type UpdateCenterView } from '../../lib/updateCenterView'
import type { SdkStatus } from '../SdkVersionBadge'
import {
  IconGit,
  IconExternalLink,
  IconRefresh,
  IconBolt,
  IconAlertTriangle,
  IconArrowRight,
  IconCheck,
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
}

const CHIP = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium'

function prNumberFrom(url: string | undefined): string | null {
  const m = url?.match(/\/pull\/(\d+)/)
  return m ? `#${m[1]}` : null
}

function VersionTable({ view }: { view: UpdateCenterView }) {
  if (view.packages.length === 0) {
    return (
      <p className="text-xs text-fg-muted">
        Not checked yet — no app has reported its Mushi SDK version. It shows up after your app
        sends its first heartbeat or report.
      </p>
    )
  }
  return (
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
            <td className="py-1.5 pr-3 font-mono">{p.package}</td>
            <td className="py-1.5 pr-3 font-mono">{p.installed ?? 'not checked yet'}</td>
            <td className="py-1.5 pr-3 font-mono">{p.latest ?? 'not checked yet'}</td>
            <td className="py-1.5">
              {p.current === true ? (
                <span className={`${CHIP} ${CHIP_TONE.okSubtle}`}>
                  <IconCheck className="h-3 w-3" aria-hidden />
                  Up to date
                </span>
              ) : p.current === false ? (
                <span className={`${CHIP} ${CHIP_TONE.warnSubtle}`}>Update available</span>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const CI_CHIP: Record<UpdateCenterView['ci'], { label: string; tone: string }> = {
  passing: { label: 'CI passing', tone: CHIP_TONE.okSubtle },
  failing: { label: 'CI failing', tone: CHIP_TONE.dangerSubtle },
  running: { label: 'CI running', tone: CHIP_TONE.infoSubtle },
  not_checked: { label: 'CI not checked yet', tone: CHIP_TONE.neutral },
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

      {!hasGithubReady && (
        <HelpBanner
          tone="warn"
          title="GitHub not ready for upgrade PRs"
          icon={<IconAlertTriangle className="h-4 w-4 text-warning-foreground" />}
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

      {/* State line — one sentence about where the upgrade stands. */}
      {view.mode === 'up_to_date' && (
        <p className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium ${CHIP_TONE.okSubtle}`}>
          <IconCheck className="h-3.5 w-3.5" aria-hidden />
          Up to date — nothing to upgrade.
        </p>
      )}
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
            <span className={`${CHIP} ${ci.tone}`}>{ci.label}</span>
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
      {view.mode === 'failed' && state.error && (
        <p className="text-xs text-danger-foreground">{state.error}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {hasGithubReady ? (
          <>
            {(view.mode === 'pr_open' || view.mode === 'pr_merged') && state.prUrl ? (
              <Btn
                size="md"
                variant={view.mode === 'pr_open' ? 'primary' : 'ghost'}
                className="gap-2"
                href={state.prUrl}
              >
                <IconExternalLink className="h-4 w-4" aria-hidden />
                View PR {prNumberFrom(state.prUrl) ?? ''}
              </Btn>
            ) : null}
            {view.mode === 'pr_open' && view.newerThanPr ? (
              <Tooltip content="Move the open PR to the newest release." side="top">
                <Btn
                  size="md"
                  variant="ghost"
                  disabled={isInFlight}
                  onClick={() => void refreshUpgradePr()}
                  className="gap-2"
                >
                  <IconRefresh className="h-4 w-4" aria-hidden />
                  Update PR to {view.packages[0]?.latest}
                </Btn>
              </Tooltip>
            ) : null}
            {(view.mode === 'pr_open' || view.mode === 'pr_merged') && state.jobId ? (
              <Btn
                size="md"
                variant="ghost"
                disabled={isInFlight}
                onClick={() => void syncStatus(state.jobId!)}
                className="gap-2"
              >
                Check CI status
              </Btn>
            ) : null}
            {view.upgradeLabel ? (
              <Btn
                size="md"
                variant="primary"
                loading={isInFlight}
                disabled={isInFlight}
                onClick={() => void createUpgradePr()}
                className="gap-2"
              >
                <IconBolt className="h-4 w-4" aria-hidden />
                {view.upgradeLabel}
              </Btn>
            ) : null}
            {view.mode === 'failed' ? (
              <Btn
                size="md"
                variant="primary"
                onClick={() => void refreshUpgradePr()}
                className="gap-2"
              >
                <IconRefresh className="h-4 w-4" aria-hidden />
                Try the upgrade again
              </Btn>
            ) : null}
            {view.mode === 'not_checked' || view.mode === 'repo_current' || view.mode === 'up_to_date' ? (
              <Tooltip content="Scan your repo's package.json files for older @mushi-mushi/* versions." side="top">
                <Btn
                  size="md"
                  variant="ghost"
                  loading={isInFlight}
                  disabled={isInFlight}
                  onClick={() => void createUpgradePr()}
                  className="gap-2"
                >
                  <IconRefresh className="h-4 w-4" aria-hidden />
                  {view.mode === 'not_checked' ? 'Check my repo' : 'Check again'}
                </Btn>
              </Tooltip>
            ) : null}
          </>
        ) : (
          <Btn to="/integrations/config#platform-card-github" size="md" variant="ghost" className="gap-2">
            <IconGit className="h-4 w-4" aria-hidden />
            Connect GitHub in Integrations
            <IconArrowRight className="h-4 w-4" aria-hidden />
          </Btn>
        )}

        <Tooltip content="Copy the mushi upgrade CLI command" side="top">
          <CopyButton value="mushi upgrade" label="Copy CLI command" copiedLabel="Copied" size="sm" />
        </Tooltip>

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
