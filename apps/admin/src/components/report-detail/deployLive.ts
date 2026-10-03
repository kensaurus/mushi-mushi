/**
 * FILE: apps/admin/src/components/report-detail/deployLive.ts
 * PURPOSE: Copy and tone for the report header's deploy chip: is the merged
 *          fix running in production? (`deploy_live` from
 *          GET /v1/admin/reports/:id, server `_shared/report-deploy-live.ts`).
 */

import type { BadgeTone } from '../ui'
import type { ReportDeployLive } from './types'

/** Short SHA for display: 7 characters, the way git and GitHub print it. */
export function shortSha(sha: string): string {
  return sha.trim().slice(0, 7)
}

export function deployLiveLabel(d: ReportDeployLive): string {
  switch (d.state) {
    case 'live':
      return 'Fixed and live'
    case 'not_live':
      return d.prod_commit ? `Fixed — not live yet (prod is on ${shortSha(d.prod_commit)})` : 'Fixed — not live yet'
    case 'unknown':
      return 'Fixed — live status unknown'
  }
}

/** Tooltip: the server's reason plus the deploy target it read. */
export function deployLiveTitle(d: ReportDeployLive): string {
  return d.target_id ? `${d.reason} Target: ${d.target_id}.` : d.reason
}

export const DEPLOY_LIVE_TONE: Record<ReportDeployLive['state'], BadgeTone> = {
  live: 'okSubtle',
  not_live: 'warnSubtle',
  unknown: 'neutral',
}
