/**
 * FILE: apps/admin/src/components/projects/BulkSdkUpgradePanel.tsx
 * PURPOSE: One-click "Update all projects" — fan out the existing per-project
 *          "Create Upgrade PR" flow across every GitHub-connected project so the
 *          operator never has to switch active project and click N times.
 *
 * WHY: Every other upgrade affordance (ConnectPage UpdateCenter, the
 *      SdkUpgradeCTA on the projects list, the DashboardPage banner) is bound to
 *      a single active/selected project. Upgrading a whole workspace meant
 *      Switch → Create Upgrade PR → wait, repeated once per repo. This panel
 *      gives an aggregate view ("which repos are behind") plus a single button
 *      that enqueues an upgrade PR for all eligible repos at once.
 *
 * DESIGN: Each row mounts the existing `useSdkUpgrade(projectId)` hook, so it
 *      reuses the fully-tested enqueue → SSE → poll → resume machinery and the
 *      already-deployed `POST /v1/admin/projects/:pid/sdk-upgrade` endpoint —
 *      no new backend surface, no new migration, no edge-function deploy. The
 *      "Update all" button bumps a `runToken`; each eligible row fires its own
 *      `createUpgradePr()` when the token changes. POST dedupe: in-flight jobs
 *      return 409; open upgrade PRs return 200 reused (no new branch); use
 *      `refreshUpgradePr()` to update an existing PR branch.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, Btn, Tooltip, MetricTooltipContent } from '../ui'
import { CHIP_TONE } from '../../lib/chipTone'
import { CodeInline } from '../CodePanel'
import {
  IconBolt,
  IconCheck,
  IconExternalLink,
  IconGit,
  IconInfo,
  IconRefresh,
} from '../icons'
import { useSdkUpgrade, type BumpEntry, type SdkUpgradeStatus } from '../../lib/useSdkUpgrade'
import { resolveSdkDisplay } from '../../lib/sdkVersionCompare'
import {
  buildFreshnessTooltip,
  buildPanelLegendTooltip,
  buildPrJobTooltip,
  buildReleaseStatusTooltip,
  catalogPrSignalsConflict,
  freshnessChipLabel,
  prJobChipLabel,
} from '../../lib/bulkSdkUpgradeTooltips'
import type { SdkStatus } from '../SdkVersionBadge'

export interface BulkUpgradeProject {
  id: string
  name: string
  slug: string
  sdk_package?: string | null
  sdk_version?: string | null
  sdk_latest_version?: string | null
  sdk_status?: SdkStatus
  sdk_observation_source?: string | null
  /** True when a GitHub repo is connected (upgrade PRs require it). */
  hasRepo: boolean
}

const IN_FLIGHT: SdkUpgradeStatus[] = ['queueing', 'queued', 'running']

// ---------------------------------------------------------------------------
// Per-row live status pill (mirrors ConnectPage UpgradeStatusIndicator).
// ---------------------------------------------------------------------------
function RowStatus({
  status,
  prUrl,
  error,
  plan,
  releaseStatus,
  project,
}: {
  status: SdkUpgradeStatus
  prUrl?: string
  error?: string
  plan?: BumpEntry[]
  releaseStatus?: string
  project: BulkUpgradeProject
}) {
  const tooltip = buildPrJobTooltip({ status, prUrl, error, plan, releaseStatus, project })
  const label = prJobChipLabel(status)
  const spinner = (
    <span
      className="inline-block h-3 w-3 shrink-0 rounded-full border-2 border-current/30 border-t-current motion-safe:animate-spin"
      aria-hidden
    />
  )

  const wrap = (node: React.ReactNode, ariaLive: 'polite' | 'assertive' = 'polite') => (
    <Tooltip content={<MetricTooltipContent data={tooltip} />} side="top" nowrap={false} portal>
      <span role="status" aria-live={ariaLive} className="cursor-help inline-flex">
        {node}
      </span>
    </Tooltip>
  )

  if (status === 'queueing' || status === 'queued') {
    return wrap(
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-overlay px-2.5 py-0.5 text-2xs text-fg-muted border border-edge-subtle">
        {spinner} {label}
      </span>,
    )
  }
  if (status === 'running') {
    return wrap(
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-2xs font-medium ${CHIP_TONE.accentSubtle}`}>
        {spinner} {label}
      </span>,
    )
  }
  if (status === 'completed' && prUrl) {
    return wrap(
      <a
        href={prUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-2xs font-medium hover:bg-ok-muted/40 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${CHIP_TONE.okSubtle}`}
      >
        <IconCheck className="h-3.5 w-3.5" aria-hidden /> {label}
        <IconExternalLink className="h-3.5 w-3.5 opacity-60" aria-hidden />
      </a>,
    )
  }
  if (status === 'completed_no_pr') {
    return wrap(
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-2xs font-medium ${CHIP_TONE.infoSubtle}`}>
        <IconCheck className="h-3.5 w-3.5" aria-hidden /> {label}
      </span>,
    )
  }
  if (status === 'failed') {
    return wrap(
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-2xs font-medium ${CHIP_TONE.dangerSubtle}`}>
        {label}
      </span>,
      'assertive',
    )
  }
  return null
}

// ---------------------------------------------------------------------------
// Static freshness chip shown before any job runs.
// ---------------------------------------------------------------------------
function FreshnessChip({
  project,
  upgradeStatus,
}: {
  project: BulkUpgradeProject
  upgradeStatus?: SdkUpgradeStatus
}) {
  const resolution = resolveSdkDisplay({
    observedVersion: project.sdk_version ?? null,
    latestVersion: project.sdk_latest_version ?? null,
    backendStatus: project.sdk_status,
    deprecated: project.sdk_status === 'deprecated',
  })
  const { prefix, text } = freshnessChipLabel(project)
  const tooltip = buildFreshnessTooltip(project, upgradeStatus)
  const conflict = catalogPrSignalsConflict(project, upgradeStatus)

  const toneClass = (() => {
    if (resolution.kind === 'deprecated') {
      return CHIP_TONE.dangerSubtle
    }
    if (resolution.kind === 'upgrade-available') {
      return conflict
        ? `${CHIP_TONE.warnSubtle} ring-1 ring-info/25`
        : CHIP_TONE.warnSubtle
    }
    if (resolution.kind === 'up-to-date') {
      return CHIP_TONE.okSubtle
    }
    if (resolution.kind === 'catalog-ahead') {
      return CHIP_TONE.infoSubtle
    }
    return CHIP_TONE.neutral
  })()

  return (
    <Tooltip content={<MetricTooltipContent data={tooltip} />} side="top" nowrap={false} portal>
      <span
        className={`inline-flex cursor-help items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium ${toneClass}`}
        aria-label={`Catalog freshness: ${text}`}
      >
        <span className="text-3xs font-semibold uppercase tracking-wide opacity-70">{prefix}</span>
        {resolution.kind === 'up-to-date' && <IconCheck className="h-3 w-3" aria-hidden />}
        {resolution.kind === 'deprecated' && text === 'Deprecated' && resolution.upgradeTarget
          ? `Deprecated → v${resolution.upgradeTarget}`
          : text}
      </span>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// Release status pill shown in the cockpit section after a PR is opened.
// ---------------------------------------------------------------------------
const RELEASE_STATUS_LABELS: Record<string, string> = {
  pr_opened: 'Awaiting CI',
  blocked: 'CI blocked',
  ready_to_merge: 'Ready to merge',
  merging: 'Merging…',
  merged: 'Merged',
  deploying: 'Deploying…',
  deployed: 'Deployed',
  verified: 'Verified',
  failed: 'Release failed',
}
const RELEASE_STATUS_COLORS: Record<string, string> = {
  pr_opened: CHIP_TONE.accentSubtle,
  blocked: CHIP_TONE.dangerSubtle,
  ready_to_merge: CHIP_TONE.okSubtle,
  merging: CHIP_TONE.accentSubtle,
  merged: CHIP_TONE.okSubtle,
  deploying: CHIP_TONE.accentSubtle,
  deployed: CHIP_TONE.okSubtle,
  verified: CHIP_TONE.okSubtle,
  failed: CHIP_TONE.dangerSubtle,
}

function ReleaseStatusPill({
  releaseStatus,
  checkRunConclusion,
  deployUrl,
  prUrl,
}: {
  releaseStatus: string | undefined
  checkRunConclusion?: string
  deployUrl?: string
  prUrl?: string
}) {
  if (!releaseStatus) return null
  const label = RELEASE_STATUS_LABELS[releaseStatus] ?? releaseStatus
  const color = RELEASE_STATUS_COLORS[releaseStatus] ?? CHIP_TONE.neutral
  return (
    <Tooltip
      content={
        <MetricTooltipContent
          data={buildReleaseStatusTooltip(releaseStatus, { checkRunConclusion, deployUrl, prUrl })}
        />
      }
      side="top"
      nowrap={false}
      portal
    >
      <span className={`inline-flex cursor-help items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium ${color}`}>
        {label}
      </span>
    </Tooltip>
  )
}

export interface RowReleaseMeta {
  releaseStatus?: string
  jobId?: string
  checkRunConclusion?: string
  deployUrl?: string
  prUrl?: string
}

// ---------------------------------------------------------------------------
// One row = one project. Mounts the existing per-project upgrade hook.
// ---------------------------------------------------------------------------
function BulkUpgradeRow({
  project,
  runToken,
  syncToken,
  mergeToken,
  onStatus,
  onReleaseMeta,
}: {
  project: BulkUpgradeProject
  runToken: number
  syncToken: number
  mergeToken: number
  onStatus: (id: string, status: SdkUpgradeStatus) => void
  onReleaseMeta: (id: string, meta: RowReleaseMeta | null) => void
}) {
  const { state, createUpgradePr, refreshUpgradePr, mergePr, syncStatus } = useSdkUpgrade(project.id)
  const lastRunToken = useRef(0)
  const lastSyncToken = useRef(0)
  const lastMergeToken = useRef(0)

  // Report status up so the panel header can summarise progress.
  useEffect(() => {
    onStatus(project.id, state.status)
  }, [project.id, state.status, onStatus])

  // Report release metadata for panel-level Refresh all / Merge all ready.
  useEffect(() => {
    if (state.status === 'completed' && state.prUrl && state.jobId) {
      onReleaseMeta(project.id, {
        releaseStatus: state.releaseStatus,
        jobId: state.jobId,
        checkRunConclusion: state.checkRunConclusion,
        deployUrl: state.deployUrl,
        prUrl: state.prUrl,
      })
      return
    }
    onReleaseMeta(project.id, null)
  }, [
    project.id,
    state.status,
    state.prUrl,
    state.jobId,
    state.releaseStatus,
    state.checkRunConclusion,
    state.deployUrl,
    onReleaseMeta,
  ])

  // Fire when the "Open PRs" button bumps the shared runToken — skip rows that
  // already have an open PR (completed) so bulk update cannot stack duplicates.
  useEffect(() => {
    if (runToken === 0 || runToken === lastRunToken.current) return
    lastRunToken.current = runToken
    if (state.status === 'completed' && state.prUrl) return
    if (state.status !== 'idle' && state.status !== 'failed') return
    void createUpgradePr()
  }, [runToken, state.status, state.prUrl, createUpgradePr])

  // Panel-level Refresh all — sync CI / deploy for every open PR row.
  useEffect(() => {
    if (syncToken === 0 || syncToken === lastSyncToken.current) return
    lastSyncToken.current = syncToken
    if (state.status !== 'completed' || !state.jobId) return
    void syncStatus(state.jobId)
  }, [syncToken, state.status, state.jobId, syncStatus])

  // Panel-level Merge all ready — only rows with green CI.
  useEffect(() => {
    if (mergeToken === 0 || mergeToken === lastMergeToken.current) return
    lastMergeToken.current = mergeToken
    if (state.releaseStatus !== 'ready_to_merge' || !state.jobId) return
    void mergePr(state.jobId)
  }, [mergeToken, state.releaseStatus, state.jobId, mergePr])

  const inFlight = IN_FLIGHT.includes(state.status)
  const signalConflict = catalogPrSignalsConflict(project, state.status)
  const hasOpenPr = state.status === 'completed' && Boolean(state.prUrl)
  const showOpenAction = inFlight || state.status === 'idle' || state.status === 'failed'
  const showRefreshAction = hasOpenPr && !inFlight

  return (
    <div className="border-t border-edge-subtle px-3 py-2 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <IconGit className="h-4 w-4 shrink-0 text-fg-faint" aria-hidden />
          <span className="truncate text-sm font-medium text-fg" title={project.name}>
            {project.name}
          </span>
          <CodeInline className="hidden text-2xs sm:inline-flex">{project.slug}</CodeInline>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <FreshnessChip project={project} upgradeStatus={state.status} />
          {state.status !== 'idle' && (
            <RowStatus
              status={state.status}
              prUrl={state.prUrl}
              error={state.error}
              plan={state.plan}
              releaseStatus={state.releaseStatus}
              project={project}
            />
          )}
          {showOpenAction && (
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => void createUpgradePr()}
              disabled={inFlight}
              leadingIcon={
                state.status === 'failed'
                  ? <IconRefresh className="h-3.5 w-3.5" aria-hidden />
                  : <IconBolt className="h-3.5 w-3.5" aria-hidden />
              }
              aria-label={`Open SDK bump PR for ${project.name}`}
            >
              {inFlight ? 'Opening…' : state.status === 'failed' ? 'Retry PR' : 'Open PR'}
            </Btn>
          )}
          {showRefreshAction && (
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => void refreshUpgradePr()}
              leadingIcon={<IconRefresh className="h-3.5 w-3.5" aria-hidden />}
              aria-label={`Refresh existing upgrade PR for ${project.name}`}
            >
              Refresh PR
            </Btn>
          )}
        </div>
      </div>

      {signalConflict && (
        <Tooltip
          content={
            <MetricTooltipContent
              data={buildFreshnessTooltip(project, state.status)}
            />
          }
          side="bottom"
          nowrap={false}
          portal
        >
          <p className="mt-1 cursor-help text-2xs leading-snug text-fg-muted">
            <span className="font-medium text-info">Two signals:</span> catalog shows a newer npm
            release, but no package.json bump PR was needed (often a{' '}
            <CodeInline>workspace:*</CodeInline> monorepo). Hover chips for details.
          </p>
        </Tooltip>
      )}

      {/* Compact release hint — full actions live in the panel header */}
      {state.status === 'completed' && state.prUrl && state.releaseStatus && (
        <div className="mt-1">
          <ReleaseStatusPill
            releaseStatus={state.releaseStatus}
            checkRunConclusion={state.checkRunConclusion}
            deployUrl={state.deployUrl}
            prUrl={state.prUrl}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------
export function BulkSdkUpgradePanel({ projects }: { projects: BulkUpgradeProject[] }) {
  const eligible = useMemo(() => projects.filter((p) => p.hasRepo), [projects])
  const ineligibleCount = projects.length - eligible.length

  const [runToken, setRunToken] = useState(0)
  const [syncToken, setSyncToken] = useState(0)
  const [mergeToken, setMergeToken] = useState(0)
  const [statusMap, setStatusMap] = useState<Record<string, SdkUpgradeStatus>>({})
  const [releaseMetaMap, setReleaseMetaMap] = useState<Record<string, RowReleaseMeta>>({})

  const handleStatus = useCallback((id: string, status: SdkUpgradeStatus) => {
    setStatusMap((prev) => (prev[id] === status ? prev : { ...prev, [id]: status }))
  }, [])

  const handleReleaseMeta = useCallback((id: string, meta: RowReleaseMeta | null) => {
    setReleaseMetaMap((prev) => {
      if (!meta) {
        if (!(id in prev)) return prev
        const { [id]: _removed, ...rest } = prev
        return rest
      }
      const cur = prev[id]
      if (
        cur?.releaseStatus === meta.releaseStatus
        && cur?.jobId === meta.jobId
        && cur?.checkRunConclusion === meta.checkRunConclusion
        && cur?.deployUrl === meta.deployUrl
      ) {
        return prev
      }
      return { ...prev, [id]: meta }
    })
  }, [])

  const statuses = Object.values(statusMap)
  const anyInFlight = statuses.some((s) => IN_FLIGHT.includes(s))
  const prCount = statuses.filter((s) => s === 'completed').length
  const upToDateCount = statuses.filter((s) => s === 'completed_no_pr').length
  const failedCount = statuses.filter((s) => s === 'failed').length
  const readyToMergeCount = Object.values(releaseMetaMap).filter(
    (m) => m.releaseStatus === 'ready_to_merge',
  ).length

  // Rows still worth bulk-opening: never run, idle, or failed — not rows that
  // already have an open PR (completed) or are up to date (completed_no_pr).
  const pendingCount = eligible.filter((p) => {
    const s = statusMap[p.id]
    return !s || s === 'idle' || s === 'failed'
  }).length
  const nothingToDo = statuses.length > 0 && !anyInFlight && pendingCount === 0

  if (eligible.length === 0) {
    if (projects.length === 0) return null
    return (
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <IconGit className="h-5 w-5 shrink-0 text-fg-muted" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg">SDK version upgrades</p>
            <p className="mt-0.5 text-xs text-fg-muted">
              Connect GitHub on a project to open bump PRs for{' '}
              <CodeInline>@mushi-mushi/*</CodeInline>.
            </p>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge-subtle bg-surface-raised px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <IconBolt className="h-4 w-4 text-accent" aria-hidden />
            <h3 className="text-sm font-semibold text-fg">SDK version upgrades</h3>
            <Tooltip
              content={<MetricTooltipContent data={buildPanelLegendTooltip()} />}
              side="bottom"
              nowrap={false}
              portal
            >
              <button
                type="button"
                className="inline-flex cursor-help items-center rounded-sm text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                aria-label="How catalog freshness and upgrade PRs relate"
              >
                <IconInfo className="h-3.5 w-3.5" aria-hidden />
              </button>
            </Tooltip>
          </div>
          <p className="mt-0.5 text-xs text-fg-muted">
            Open bump PRs on GitHub, then refresh CI and merge when green. Hover chips for
            version details.
          </p>
          {(prCount > 0 || upToDateCount > 0 || failedCount > 0 || readyToMergeCount > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="status" aria-live="polite">
              {prCount > 0 && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium ${CHIP_TONE.okSubtle}`}>
                  {prCount} PR{prCount === 1 ? '' : 's'} to review
                </span>
              )}
              {readyToMergeCount > 0 && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium ${CHIP_TONE.okSubtle}`}>
                  {readyToMergeCount} ready to merge
                </span>
              )}
              {upToDateCount > 0 && (
                <Tooltip
                  content="No package.json bump PR was created — registry pins already latest or only workspace:* deps."
                  side="top"
                >
                  <span className={`inline-flex cursor-help items-center gap-1 rounded-full px-2 py-0.5 text-2xs ${CHIP_TONE.neutral}`}>
                    {upToDateCount} no PR needed
                  </span>
                </Tooltip>
              )}
              {failedCount > 0 && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium ${CHIP_TONE.dangerSubtle}`}>
                  {failedCount} PR{failedCount === 1 ? '' : 's'} failed
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {prCount > 0 && (
            <Tooltip
              content="Pull the latest CI and deploy status from GitHub for every open bump PR."
              side="top"
            >
              <Btn
                size="md"
                variant="ghost"
                onClick={() => setSyncToken((t) => t + 1)}
                leadingIcon={<IconRefresh className="h-4 w-4" aria-hidden />}
                aria-label="Refresh CI and deploy status for all open PRs"
              >
                Refresh all
              </Btn>
            </Tooltip>
          )}
          {readyToMergeCount > 0 && (
            <Tooltip
              content={`Squash-merge ${readyToMergeCount} PR${readyToMergeCount === 1 ? '' : 's'} that passed CI.`}
              side="top"
            >
              <Btn
                size="md"
                variant="ghost"
                onClick={() => setMergeToken((t) => t + 1)}
                leadingIcon={<IconCheck className="h-4 w-4" aria-hidden />}
                aria-label={`Merge ${readyToMergeCount} PRs that passed CI`}
              >
                Merge all ready ({readyToMergeCount})
              </Btn>
            </Tooltip>
          )}
          <Tooltip
            content={
              anyInFlight
                ? 'Opening bump PRs on GitHub…'
                : nothingToDo
                  ? 'Every connected repo already has an open PR or does not need a bump.'
                  : `Open a draft bump PR on ${pendingCount} connected repo${pendingCount === 1 ? '' : 's'}.`
            }
            side="top"
          >
            <Btn
              size="md"
              variant="primary"
              loading={anyInFlight}
              disabled={anyInFlight || nothingToDo}
              onClick={() => setRunToken((t) => t + 1)}
              leadingIcon={
                nothingToDo
                  ? <IconCheck className="h-4 w-4" aria-hidden />
                  : <IconBolt className="h-4 w-4" aria-hidden />
              }
            >
              {anyInFlight
                ? 'Opening PRs…'
                : nothingToDo
                  ? 'Nothing to open'
                  : `Open PRs (${pendingCount})`}
            </Btn>
          </Tooltip>
        </div>
      </div>

      <div>
        {eligible.map((project) => (
          <BulkUpgradeRow
            key={project.id}
            project={project}
            runToken={runToken}
            syncToken={syncToken}
            mergeToken={mergeToken}
            onStatus={handleStatus}
            onReleaseMeta={handleReleaseMeta}
          />
        ))}
      </div>

      {ineligibleCount > 0 && (
        <p className="border-t border-edge-subtle px-4 py-2 text-2xs text-fg-muted">
          {ineligibleCount} other project{ineligibleCount === 1 ? '' : 's'} ha{ineligibleCount === 1 ? 's' : 've'} no
          connected repo — connect GitHub to include {ineligibleCount === 1 ? 'it' : 'them'}.
        </p>
      )}
    </Card>
  )
}
