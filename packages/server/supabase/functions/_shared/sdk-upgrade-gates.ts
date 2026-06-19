/**
 * Pure gate logic for POST /v1/admin/projects/:pid/sdk-upgrade.
 * Extracted for unit tests and shared between the API route and worker docs.
 */

import type { OpenPrRef } from './github-pr.ts'

/** Branch family for machine-generated SDK upgrade PRs (must match sdk-upgrade-runner). */
export const UPGRADE_BRANCH_PREFIX = 'mushi/sdk-upgrade'

export interface SdkUpgradeProjectSettings {
  github_repo_url: string | null
  github_installation_token_ref: string | null
}

export interface SdkUpgradeInFlightJob {
  id: string
  status: string
}

export interface SdkUpgradePostBody {
  /** Re-enqueue even when an open upgrade PR already exists (refreshes its branch). */
  refresh?: boolean
  /** Bypass open-PR reuse guard (legacy alias for refresh). */
  force?: boolean
}

export type SdkUpgradePostDecision =
  | { action: 'reject'; code: string; status: number; jobId?: string; message: string }
  | {
      action: 'reuse'
      prUrl: string
      prNumber: number
      branch: string
      message: string
    }
  | { action: 'enqueue' }

export function evaluateSdkUpgradePostGate(
  settings: SdkUpgradeProjectSettings | null,
  inFlight: SdkUpgradeInFlightJob[],
  openPr: OpenPrRef | null,
  body: SdkUpgradePostBody = {},
): SdkUpgradePostDecision {
  if (!settings?.github_repo_url) {
    return {
      action: 'reject',
      code: 'GITHUB_NOT_CONNECTED',
      status: 400,
      message: 'Connect a GitHub repository in Settings → Integrations first.',
    }
  }
  if (!settings.github_installation_token_ref) {
    return {
      action: 'reject',
      code: 'GITHUB_TOKEN_MISSING',
      status: 400,
      message: 'No GitHub token configured for this project. Add one in Settings → Integrations.',
    }
  }
  if (inFlight.length > 0) {
    return {
      action: 'reject',
      code: 'ALREADY_IN_PROGRESS',
      status: 409,
      jobId: inFlight[0].id,
      message: 'An SDK upgrade is already in progress for this project.',
    }
  }

  const wantsNewRun = body.refresh === true || body.force === true
  if (openPr && !wantsNewRun) {
    return {
      action: 'reuse',
      prUrl: openPr.url,
      prNumber: openPr.number,
      branch: openPr.headRef,
      message:
        'An upgrade PR is already open for this repo. Refresh it to pick up newer catalog versions, or review the existing PR on GitHub.',
    }
  }

  return { action: 'enqueue' }
}
