/**
 * FILE: apps/admin/src/lib/projectSnapshotTypes.ts
 * PURPOSE: Typed subset of GET /v1/admin/projects fields consumed by
 *          header/switcher snapshot chrome (bottleneck, trend, SDK, severity).
 */

import type { SdkStatus } from '../components/SdkVersionBadge'
import type { PdcaStageId } from './pdca'

export interface SeverityBreakdown30d {
  critical: number
  major: number
  minor: number
  trivial: number
  other: number
  total: number
}

export interface Trend7d {
  last7d: number
  prev7d: number
  delta: number
  direction: 'up' | 'down' | 'flat'
}

export interface ProjectSnapshot {
  id: string
  name: string
  slug: string
  last_report_at: string | null
  pdca_bottleneck: PdcaStageId | null
  pdca_bottleneck_label: string | null
  sdk_package?: string | null
  sdk_version?: string | null
  sdk_latest_version?: string | null
  sdk_deprecation_message?: string | null
  sdk_status?: SdkStatus
  severity_breakdown_30d?: SeverityBreakdown30d
  trend_7d?: Trend7d
  primary_repo?: { repo_url: string | null; default_branch?: string | null } | null
  api_keys?: Array<{
    is_active?: boolean
    revoked?: boolean
    last_seen_origin?: string | null
    last_seen_at?: string | null
  }>
}
