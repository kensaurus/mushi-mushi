/**
 * FILE: apps/admin/src/components/SdkVersionBadge.tsx
 * PURPOSE: Per-project SDK freshness pill with semver-aware labels and
 *          a rich hover tooltip. Never shows "v1.7.7 → v0.9.0" when the
 *          catalogue row is stale — only surfaces real upgrade paths.
 */

import { Badge, MetricTooltipContent, Tooltip, type MetricTooltipData } from './ui'
import { resolveSdkDisplay } from '../lib/sdkVersionCompare'

export type SdkStatus = 'up-to-date' | 'outdated' | 'deprecated' | 'unknown'

interface SdkVersionBadgeProps {
  status: SdkStatus
  package_: string | null
  observedVersion: string | null
  latestVersion: string | null
  deprecationMessage?: string | null
  /** Compact switcher rows — shorter label, same tooltip depth. */
  compact?: boolean
}

type SdkDisplayResolutionTone =
  | 'up-to-date'
  | 'catalog-ahead'
  | 'upgrade-available'
  | 'deprecated'
  | 'unknown'

const STATUS_TONE: Record<Exclude<SdkDisplayResolutionTone, 'unknown'>, string> = {
  'up-to-date': 'bg-ok-muted text-ok border border-ok/30',
  'catalog-ahead': 'bg-info-muted text-info border border-info/30',
  'upgrade-available': 'bg-warn-muted text-warning-foreground border border-warn/30',
  deprecated: 'bg-danger-muted text-danger border border-danger/30',
}

function shortPackageName(package_: string | null): string {
  return package_?.replace(/^@mushi-mushi\//, '') ?? 'sdk'
}

function buildSdkTooltipData(input: {
  package_: string | null
  observedVersion: string | null
  latestVersion: string | null
  deprecationMessage?: string | null
  resolution: ReturnType<typeof resolveSdkDisplay>
}): MetricTooltipData {
  const pkg = input.package_ ?? '@mushi-mushi/web'
  const observed = input.observedVersion ?? 'unknown'
  const catalog = input.latestVersion ?? 'unknown'

  if (input.resolution.kind === 'catalog-ahead') {
    return {
      sections: [
        {
          kind: 'shows',
          label: 'Observed in reports',
          body: `This project last ingested a report from ${pkg} v${observed}. That is newer than our publish catalogue (currently v${catalog} for this package).`,
        },
        {
          kind: 'counted',
          label: 'Why this happens',
          body: 'The catalogue row updates when we ship a release — not on every npm publish. Your SDK is fine; the admin chip is waiting for the catalogue upsert.',
        },
      ],
      callout: { tone: 'ok', text: 'No upgrade needed — you are already on a newer SDK than the catalogue lists.' },
    }
  }

  if (input.resolution.kind === 'upgrade-available' && input.resolution.upgradeTarget) {
    return {
      sections: [
        {
          kind: 'shows',
          label: 'Running now',
          body: `${pkg} v${observed} — detected on the most recent report for this project.`,
        },
        {
          kind: 'takeaway',
          label: 'Recommended',
          body: `Bump to v${input.resolution.upgradeTarget} in your app to pick up the latest fixes and SDK features.`,
        },
      ],
      callout: {
        tone: 'warn',
        text: 'Run mushi upgrade in your app repo — or open Setup Copilot for the full connect → heartbeat flow.',
      },
    }
  }

  if (input.resolution.kind === 'deprecated') {
    const dep = input.deprecationMessage ?? 'This package version has been marked deprecated in the catalogue.'
    return {
      sections: [
        { kind: 'shows', label: 'Running now', body: `${pkg} v${observed}.` },
        { kind: 'takeaway', label: 'Deprecation', body: dep },
      ],
      callout: {
        tone: 'warn',
        text: input.resolution.upgradeTarget
          ? `Migrate to v${input.resolution.upgradeTarget} when you can.`
          : 'Plan a migration off this SDK version.',
      },
    }
  }

  return {
    sections: [
      {
        kind: 'shows',
        label: 'SDK version',
        body: `${pkg} v${observed} matches the latest catalogue entry (v${catalog}).`,
      },
    ],
    callout: { tone: 'ok', text: 'SDK is up to date for this package.' },
  }
}

export function SdkVersionBadge({
  status,
  package_,
  observedVersion,
  latestVersion,
  deprecationMessage,
  compact = false,
}: SdkVersionBadgeProps) {
  if (status === 'unknown' || !observedVersion) return null

  const resolution = resolveSdkDisplay({
    observedVersion,
    latestVersion,
    backendStatus: status,
    deprecated: status === 'deprecated',
  })
  if (resolution.kind === 'unknown') return null

  const shortPackage = shortPackageName(package_)
  const tooltip = buildSdkTooltipData({
    package_,
    observedVersion,
    latestVersion,
    deprecationMessage,
    resolution,
  })

  const toneKey = resolution.kind as SdkDisplayResolutionTone
  const toneClass =
    toneKey === 'unknown' ? 'bg-surface-overlay text-fg-muted border border-edge-subtle' : STATUS_TONE[toneKey]

  const label = (() => {
    const base = `${shortPackage} v${observedVersion}`
    if (compact) {
      if (resolution.kind === 'upgrade-available' && resolution.upgradeTarget) {
        return `↑ v${resolution.upgradeTarget}`
      }
      if (resolution.kind === 'deprecated') return 'Deprecated'
      if (resolution.kind === 'catalog-ahead') return 'Ahead'
      if (resolution.kind === 'up-to-date') return 'Current'
      return `v${observedVersion}`
    }
    if (resolution.kind === 'upgrade-available' && resolution.upgradeTarget) {
      return (
        <>
          <span className="font-mono text-2xs">{base}</span>
          <span className="ml-1 text-2xs opacity-80">→ v{resolution.upgradeTarget}</span>
        </>
      )
    }
    if (resolution.kind === 'catalog-ahead') {
      return (
        <>
          <span className="font-mono text-2xs">{base}</span>
          <span className="ml-1 text-2xs opacity-80">catalog stale</span>
        </>
      )
    }
    if (resolution.kind === 'up-to-date') {
      return <span className="font-mono text-2xs">{base} ✓</span>
    }
    if (resolution.kind === 'deprecated') {
      return <span className="font-mono text-2xs">{base} ⚠</span>
    }
    return <span className="font-mono text-2xs">{base}</span>
  })()

  const aria =
    resolution.kind === 'upgrade-available'
      ? `SDK upgrade available to v${resolution.upgradeTarget}`
      : resolution.kind === 'catalog-ahead'
        ? 'SDK newer than catalogue'
        : resolution.kind === 'deprecated'
          ? 'SDK version deprecated'
          : 'SDK up to date'

  return (
    <Tooltip content={<MetricTooltipContent data={tooltip} />} side="left" nowrap={false} portal>
      <Badge className={`cursor-help ${toneClass}`} aria-label={aria}>
        {label}
      </Badge>
    </Tooltip>
  )
}
