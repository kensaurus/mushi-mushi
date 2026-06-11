/**
 * FILE: apps/admin/src/components/ActiveProjectStatusChip.tsx
 * PURPOSE: Inline status affordances on the project switcher trigger with
 *          rich tooltips explaining bottleneck, trend, and SDK signals.
 */

import type { ProjectSnapshot } from '../lib/projectSnapshotTypes'
import { PDCA_BOTTLENECK_TONE, bottleneckStageLetter } from '../lib/pdcaBottleneck'
import { buildBottleneckTooltip, buildTrendTooltip } from '../lib/projectMetaTooltips'
import { resolveSdkDisplay } from '../lib/sdkVersionCompare'
import { MetricTooltipContent, Tooltip } from './ui'

interface ActiveProjectStatusChipProps {
  snapshot: ProjectSnapshot | null | undefined
}

export function ActiveProjectStatusChip({ snapshot }: ActiveProjectStatusChipProps) {
  if (!snapshot) return null

  const bottleneck = snapshot.pdca_bottleneck
  const trend = snapshot.trend_7d
  const trendUp =
    trend && trend.direction === 'up' && (trend.last7d > 0 || trend.prev7d > 0)
  const sdkResolution = resolveSdkDisplay({
    observedVersion: snapshot.sdk_version ?? null,
    latestVersion: snapshot.sdk_latest_version ?? null,
    backendStatus: snapshot.sdk_status,
    deprecated: snapshot.sdk_status === 'deprecated',
  })
  const showSdkWarn =
    sdkResolution.kind === 'upgrade-available' || sdkResolution.kind === 'deprecated'

  if (!bottleneck && !trendUp && !showSdkWarn && sdkResolution.kind !== 'catalog-ahead') {
    return null
  }

  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      {bottleneck && snapshot.pdca_bottleneck_label && (
        <Tooltip
          content={
            <MetricTooltipContent
              data={buildBottleneckTooltip(bottleneck, snapshot.pdca_bottleneck_label)}
            />
          }
          side="bottom"
          nowrap={false}
          portal
        >
          <span
            className={`inline-flex h-5 min-w-[1.25rem] cursor-help items-center justify-center rounded-sm px-1 text-3xs font-bold leading-none ${PDCA_BOTTLENECK_TONE[bottleneck]}`}
          >
            {bottleneckStageLetter(bottleneck)}
          </span>
        </Tooltip>
      )}
      {trendUp && (
        <Tooltip
          content={<MetricTooltipContent data={buildTrendTooltip(snapshot)!} />}
          side="bottom"
          nowrap={false}
          portal
        >
          <span className="inline-flex h-5 cursor-help items-center rounded-sm bg-warn-muted px-1 text-3xs font-mono font-semibold text-warn">
            ↑
          </span>
        </Tooltip>
      )}
      {(showSdkWarn || sdkResolution.kind === 'catalog-ahead') && (
        <Tooltip
          content={
            <MetricTooltipContent
              data={{
                sections: [
                  {
                    kind: 'shows',
                    label: 'SDK package',
                    body: `${snapshot.sdk_package ?? '@mushi-mushi/web'} v${snapshot.sdk_version ?? '?'}`,
                  },
                  {
                    kind: 'takeaway',
                    label: 'Status',
                    body:
                      sdkResolution.kind === 'upgrade-available'
                        ? `Upgrade available to v${sdkResolution.upgradeTarget}.`
                        : sdkResolution.kind === 'catalog-ahead'
                          ? 'Running a newer SDK than the publish catalogue lists — no action needed.'
                          : 'This SDK version is deprecated — plan a migration.',
                  },
                ],
              }}
            />
          }
          side="bottom"
          nowrap={false}
          portal
        >
          <span
            className={`inline-flex h-5 cursor-help items-center rounded-sm px-1 text-3xs font-medium ${
              sdkResolution.kind === 'deprecated'
                ? 'bg-danger-muted text-danger'
                : sdkResolution.kind === 'catalog-ahead'
                  ? 'bg-info-muted text-info'
                  : 'bg-warn-muted text-warn'
            }`}
          >
            SDK
          </span>
        </Tooltip>
      )}
    </span>
  )
}
