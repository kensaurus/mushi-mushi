/**
 * FILE: apps/admin/src/components/ProjectSnapshotMeta.tsx
 * PURPOSE: Compact project snapshot row for the switcher dropdown — bottleneck,
 *          7-day trend, SDK freshness, critical severity — each with tooltips.
 */

import { Link } from 'react-router-dom'
import type { ProjectSnapshot } from '../lib/projectSnapshotTypes'
import {
  PDCA_BOTTLENECK_TONE,
  bottleneckDeepLink,
  bottleneckStageLetter,
} from '../lib/pdcaBottleneck'
import {
  buildBottleneckTooltip,
  buildCriticalTooltip,
  buildTrendTooltip,
} from '../lib/projectMetaTooltips'
import { SdkVersionBadge } from './SdkVersionBadge'
import { SignalChip } from './report-detail/ReportSurface'
import { MetricTooltipContent, Tooltip } from './ui'

interface ProjectSnapshotMetaProps {
  snapshot: ProjectSnapshot | null | undefined
  compact?: boolean
  /**
   * Render the bottleneck chip as a plain span instead of a <Link>. Required
   * when this row sits inside another interactive element (e.g. the project
   * switcher's role="option" button) — nested anchors/buttons are invalid HTML.
   */
  linkless?: boolean
}

export function ProjectSnapshotMeta({
  snapshot,
  compact = false,
  linkless = false,
}: ProjectSnapshotMetaProps) {
  if (!snapshot) return null

  const critical = snapshot.severity_breakdown_30d?.critical ?? 0
  const trend = snapshot.trend_7d
  const showTrend =
    trend && (trend.last7d > 0 || trend.prev7d > 0) && trend.direction !== 'flat'
  const hasBottleneck = snapshot.pdca_bottleneck && snapshot.pdca_bottleneck_label
  const sdkStatus = snapshot.sdk_status
  const showSdk = sdkStatus && sdkStatus !== 'unknown'

  if (!hasBottleneck && !showTrend && !showSdk && critical === 0) {
    return null
  }

  const trendTooltip = showTrend && trend ? buildTrendTooltip(snapshot) : null

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {hasBottleneck && snapshot.pdca_bottleneck && snapshot.pdca_bottleneck_label && (
        <Tooltip
          content={
            <MetricTooltipContent
              data={buildBottleneckTooltip(snapshot.pdca_bottleneck, snapshot.pdca_bottleneck_label)}
            />
          }
          side="left"
          nowrap={false}
          portal
        >
          {linkless ? (
            <span
              className={`inline-flex min-w-0 max-w-full cursor-help items-center gap-1 truncate rounded-sm px-1.5 py-0.5 text-3xs font-medium ${PDCA_BOTTLENECK_TONE[snapshot.pdca_bottleneck]}`}
            >
              <span className="shrink-0 font-mono uppercase">
                {bottleneckStageLetter(snapshot.pdca_bottleneck)}
              </span>
            </span>
          ) : (
            <Link
              to={bottleneckDeepLink(
                snapshot.pdca_bottleneck,
                snapshot.id,
                snapshot.pdca_bottleneck_label,
              )}
              onClick={(e) => e.stopPropagation()}
              className={`inline-flex min-w-0 max-w-full cursor-help items-center gap-1 truncate rounded-sm px-1.5 py-0.5 text-3xs font-medium hover:opacity-90 motion-safe:transition-opacity ${PDCA_BOTTLENECK_TONE[snapshot.pdca_bottleneck]}`}
            >
              <span className="shrink-0 font-mono uppercase">
                {bottleneckStageLetter(snapshot.pdca_bottleneck)}
              </span>
            </Link>
          )}
        </Tooltip>
      )}
      {critical > 0 && (
        <Tooltip
          content={<MetricTooltipContent data={buildCriticalTooltip(critical)} />}
          side="left"
          nowrap={false}
          portal
        >
          <span className="cursor-help">
            <SignalChip tone="danger" className="text-3xs tabular-nums">
              Crit {critical}
            </SignalChip>
          </span>
        </Tooltip>
      )}
      {showTrend && trend && trendTooltip && (
        <Tooltip content={<MetricTooltipContent data={trendTooltip} />} side="left" nowrap={false} portal>
          <span className="cursor-help">
            <SignalChip tone={trend.direction === 'up' ? 'warn' : 'ok'} className="font-mono text-3xs tabular-nums">
              {trend.direction === 'up' ? '↑' : '↓'} {Math.abs(trend.delta)}
            </SignalChip>
          </span>
        </Tooltip>
      )}
      {showSdk && sdkStatus && (
        <SdkVersionBadge
          status={sdkStatus}
          package_={snapshot.sdk_package ?? null}
          observedVersion={snapshot.sdk_version ?? null}
          latestVersion={snapshot.sdk_latest_version ?? null}
          deprecationMessage={snapshot.sdk_deprecation_message ?? null}
          compact={compact}
        />
      )}
    </div>
  )
}
