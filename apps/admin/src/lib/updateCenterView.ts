/**
 * FILE: apps/admin/src/lib/updateCenterView.ts
 * PURPOSE: Pure view model for the /connect Update center — what the SDK
 *          version row says and which single action it offers.
 *
 * Why this exists: the Update center hid the versions and kept a red "Create
 * Upgrade PR" enabled for a project already on the latest release, and it
 * showed nothing about an upgrade PR opened earlier. Every rule here comes
 * from real state: the server's freshness verdict (`sdk_status`) for the
 * version your app reports, and the latest upgrade job for the PR.
 */

import type { SdkUpgradeState } from './useSdkUpgrade'

type UpdateCenterMode =
  /** A job is queued or running right now. */
  | 'working'
  /** Bump pushed; the host lockfile workflow runs, then the PR opens. */
  | 'awaiting_lockfile'
  /** An upgrade PR is open (or not yet synced since it opened). */
  | 'pr_open'
  /** The upgrade PR merged; production may still report the old version. */
  | 'pr_merged'
  /** The last run failed. */
  | 'failed'
  /** The repo scan found every @mushi-mushi/* package already current. */
  | 'repo_current'
  /** The version your app reports is the latest release. */
  | 'up_to_date'
  /** A newer release exists for the version your app reports. */
  | 'upgrade_available'
  /** No app has reported its SDK version yet. */
  | 'not_checked'

export interface UpdateCenterProjectLike {
  sdk_package?: string | null
  sdk_version?: string | null
  sdk_latest_version?: string | null
  sdk_status?: 'up-to-date' | 'outdated' | 'deprecated' | 'unknown' | null
}

interface PackageVersionRow {
  package: string
  /** null = not checked yet. */
  installed: string | null
  latest: string | null
  current: boolean | null
}

export interface UpdateCenterView {
  mode: UpdateCenterMode
  packages: PackageVersionRow[]
  /** Version the open / merged PR moves the reported package to. */
  prTargetVersion: string | null
  /** Label for the one upgrade button, or null when none should show. */
  upgradeLabel: string | null
  /** A merged PR whose target is still behind the latest release. */
  newerThanPr: boolean
  ci: 'passing' | 'failing' | 'running' | 'not_checked'
}

/** Strip a leading `v` so "v1.31.1" and "1.31.1" compare equal. */
export function normalizeVersion(v: string | null | undefined): string | null {
  if (!v) return null
  const t = v.trim().replace(/^v/i, '')
  return t.length ? t : null
}

function cmpSemver(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10))
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10))
  for (let i = 0; i < 3; i++) {
    const d = (Number.isFinite(pa[i]) ? pa[i] : 0) - (Number.isFinite(pb[i]) ? pb[i] : 0)
    if (d !== 0) return d
  }
  return 0
}

function ciFrom(state: SdkUpgradeState): UpdateCenterView['ci'] {
  const c = state.checkRunConclusion
  if (c === 'success' || c === 'neutral' || c === 'skipped') return 'passing'
  if (c === 'failure' || c === 'timed_out' || c === 'cancelled' || c === 'action_required') return 'failing'
  if (state.checkRunStatus && state.checkRunStatus !== 'completed') return 'running'
  return 'not_checked'
}

export function deriveUpdateCenterView(
  project: UpdateCenterProjectLike,
  state: SdkUpgradeState,
): UpdateCenterView {
  const pkg = project.sdk_package ?? null
  const installed = normalizeVersion(project.sdk_version)
  const latest = normalizeVersion(project.sdk_latest_version)
  const status = project.sdk_status ?? 'unknown'

  const current =
    installed && latest ? cmpSemver(installed, latest) >= 0 : status === 'up-to-date' ? true : null
  const packages: PackageVersionRow[] = pkg
    ? [{ package: pkg, installed, latest, current }]
    : []

  const planTo =
    state.plan?.find((b) => b.package === pkg)?.to ?? state.plan?.[0]?.to ?? null
  const prTargetVersion = normalizeVersion(planTo)
  const newerThanPr = Boolean(prTargetVersion && latest && cmpSemver(latest, prTargetVersion) > 0)
  const upgradeTo = latest ? `Upgrade to ${latest}` : 'Upgrade SDK'

  const base = { packages, prTargetVersion, newerThanPr, ci: ciFrom(state) }

  if (state.status === 'queueing' || state.status === 'queued' || state.status === 'running') {
    return { ...base, mode: 'working', upgradeLabel: null }
  }
  if (state.status === 'awaiting_lockfile') {
    return { ...base, mode: 'awaiting_lockfile', upgradeLabel: null }
  }
  if (state.status === 'failed') {
    return { ...base, mode: 'failed', upgradeLabel: null }
  }
  if (state.status === 'completed' && state.prUrl) {
    const merged = state.prState === 'merged' || Boolean(state.mergedAt)
    if (merged) {
      // Offer the next upgrade only when a newer release shipped after the PR.
      const needsMore = newerThanPr && current !== true
      return { ...base, mode: 'pr_merged', upgradeLabel: needsMore ? upgradeTo : null }
    }
    if (state.prState !== 'closed') {
      return { ...base, mode: 'pr_open', upgradeLabel: null }
    }
  }
  if (state.status === 'completed_no_pr') {
    return { ...base, mode: 'repo_current', upgradeLabel: null }
  }
  if (current === true) return { ...base, mode: 'up_to_date', upgradeLabel: null }
  if (status === 'outdated' || status === 'deprecated' || current === false) {
    return { ...base, mode: 'upgrade_available', upgradeLabel: upgradeTo }
  }
  return { ...base, mode: 'not_checked', upgradeLabel: null }
}
