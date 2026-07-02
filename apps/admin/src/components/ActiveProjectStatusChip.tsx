/**
 * FILE: apps/admin/src/components/ActiveProjectStatusChip.tsx
 * PURPOSE: Inline status affordances on the project switcher trigger with
 *          rich tooltips explaining bottleneck, trend, and SDK signals.
 */

import { Link } from 'react-router-dom'
import type { ProjectSnapshot } from '../lib/projectSnapshotTypes'
import {
  PDCA_BOTTLENECK_TONE,
  bottleneckChipLabel,
  bottleneckDeepLink,
  bottleneckHumanHeadline,
  bottleneckHumanHint,
} from '../lib/pdcaBottleneck'
import { buildTrendTooltip } from '../lib/projectMetaTooltips'
import { resolveSdkDisplay } from '../lib/sdkVersionCompare'
import { MetricTooltipContent, Tooltip } from './ui'
import { CHIP_TONE } from '../lib/chipTone'

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

  const bottleneckCtx = bottleneck
    ? {
        stage: bottleneck,
        label: snapshot.pdca_bottleneck_label,
      }
    : null

  return (
    <span className="inline-flex items-center gap-1 shrink-0">
      {bottleneck && snapshot.pdca_bottleneck_label && bottleneckCtx && (
        <Tooltip
          content={
            <MetricTooltipContent
              data={{
                sections: [
                  {
                    kind: 'shows',
                    label: 'Needs attention',
                    body: bottleneckHumanHeadline(bottleneckCtx),
                  },
                  {
                    kind: 'takeaway',
                    label: 'What to do',
                    body: bottleneckHumanHint(bottleneckCtx),
                  },
                ],
                callout: {
                  tone: 'info',
                  text: 'Click to open the page that clears this.',
                },
              }}
            />
          }
          side="bottom"
          nowrap={false}
          portal
        >
          <Link
            to={bottleneckDeepLink(
              bottleneck,
              snapshot.id,
              snapshot.pdca_bottleneck_label,
            )}
            // The chip renders inside the ProjectSwitcher trigger button; stop
            // the click from bubbling so navigating doesn't also toggle the
            // project dropdown.
            onClick={(e) => e.stopPropagation()}
            className={`inline-flex h-5 max-w-[6.5rem] cursor-pointer items-center truncate rounded-sm px-1 text-3xs font-semibold leading-none hover:opacity-90 ${PDCA_BOTTLENECK_TONE[bottleneck]}`}
          >
            {bottleneckChipLabel(bottleneckCtx)}
          </Link>
        </Tooltip>
      )}
      {trendUp && (
        <Tooltip
          content={<MetricTooltipContent data={buildTrendTooltip(snapshot)!} />}
          side="bottom"
          nowrap={false}
          portal
        >
          <span className={`inline-flex h-5 cursor-help items-center rounded-sm ${CHIP_TONE.warnSubtle} px-1 text-3xs font-mono font-semibold`}>
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
          <Link
            to={`/connect?project=${encodeURIComponent(snapshot.id)}`}
            onClick={(e) => e.stopPropagation()}
            className={`inline-flex h-5 cursor-pointer items-center rounded-sm px-1 text-3xs font-medium hover:opacity-90 ${
              sdkResolution.kind === 'deprecated'
                ? CHIP_TONE.dangerSubtle
                : sdkResolution.kind === 'catalog-ahead'
                  ? CHIP_TONE.infoSubtle
                  : CHIP_TONE.warnSubtle
            }`}
          >
            SDK
          </Link>
        </Tooltip>
      )}
    </span>
  )
}
