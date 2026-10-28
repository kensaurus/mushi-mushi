/**
 * FILE: apps/admin/src/components/ProjectSnapshotMeta.tsx
 * PURPOSE: Compact project snapshot row for the switcher dropdown — bottleneck,
 *          7-day trend, SDK freshness, critical severity — each with tooltips.
 *
 * NOTES:   Every chip carries its own words plus an `aria-label`/`title`. The
 *          earlier glyph-only forms ("D", "↑ 86") were unreadable without
 *          waiting out the hover tooltip, and "↑" meant both "more reports"
 *          and "SDK update available".
 */

import { Link } from 'react-router-dom'
import type { ProjectSnapshot } from '../lib/projectSnapshotTypes'
import { PDCA_STAGES } from '../lib/pdca'
import {
  PDCA_BOTTLENECK_TONE,
  bottleneckDeepLink,
} from '../lib/pdcaBottleneck'
import {
  buildBottleneckTooltip,
  buildCriticalTooltip,
  buildTrendTooltip,
} from '../lib/projectMetaTooltips'
import { criticalFiled30dLabel } from '../lib/criticalSurfaces'
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
  const stage = snapshot.pdca_bottleneck ? PDCA_STAGES[snapshot.pdca_bottleneck] : null
  const bottleneckText = stage ? `Stuck: ${stage.label}` : ''
  const bottleneckAria = stage
    ? `PDCA bottleneck: ${stage.label} — ${snapshot.pdca_bottleneck_label}`
    : ''
  const criticalAria = `${criticalFiled30dLabel(critical)}, any status`
  const trendAria = trend
    ? `Reports ${trend.direction === 'up' ? 'up' : 'down'} ${Math.abs(trend.delta)} versus the previous 7 days`
    : ''

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {hasBottleneck && snapshot.pdca_bottleneck && snapshot.pdca_bottleneck_label && stage && (
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
              aria-label={bottleneckAria}
              title={bottleneckAria}
              className={`inline-flex min-w-0 max-w-full cursor-help items-center gap-1 truncate rounded-sm px-1.5 py-0.5 text-3xs font-medium ${PDCA_BOTTLENECK_TONE[snapshot.pdca_bottleneck]}`}
            >
              <span className="min-w-0 truncate">{bottleneckText}</span>
            </span>
          ) : (
            <Link
              to={bottleneckDeepLink(
                snapshot.pdca_bottleneck,
                snapshot.id,
                snapshot.pdca_bottleneck_label,
              )}
              onClick={(e) => e.stopPropagation()}
              aria-label={bottleneckAria}
              title={bottleneckAria}
              className={`inline-flex min-w-0 max-w-full cursor-help items-center gap-1 truncate rounded-sm px-1.5 py-0.5 text-3xs font-medium hover:opacity-90 motion-safe:transition-opacity ${PDCA_BOTTLENECK_TONE[snapshot.pdca_bottleneck]}`}
            >
              <span className="min-w-0 truncate">{bottleneckText}</span>
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
          <span className="cursor-help" aria-label={criticalAria} title={criticalAria}>
            <SignalChip tone="danger" className="text-3xs tabular-nums">
              {critical} critical · 30d
            </SignalChip>
          </span>
        </Tooltip>
      )}
      {showTrend && trend && trendTooltip && (
        <Tooltip content={<MetricTooltipContent data={trendTooltip} />} side="left" nowrap={false} portal>
          <span className="cursor-help" aria-label={trendAria} title={trendAria}>
            <SignalChip tone={trend.direction === 'up' ? 'warn' : 'ok'} className="text-3xs tabular-nums">
              {trend.direction === 'up' ? '↑' : '↓'} {Math.abs(trend.delta)} reports
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
