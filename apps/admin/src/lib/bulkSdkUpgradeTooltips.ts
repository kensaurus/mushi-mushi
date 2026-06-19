/**
 * FILE: apps/admin/src/lib/bulkSdkUpgradeTooltips.ts
 * PURPOSE: Rich hover tooltips for the bulk SDK upgrade panel — explains the
 *          two independent signals (catalog freshness vs upgrade-PR job) so
 *          monorepo / workspace:* rows do not look contradictory.
 */

import { resolveSdkDisplay } from './sdkVersionCompare'
import type { MetricTooltipData } from '../components/ui'
import type { SdkStatus } from '../components/SdkVersionBadge'
import type { BumpEntry, SdkUpgradeStatus } from './useSdkUpgrade'
import type { BulkUpgradeProject } from '../components/projects/BulkSdkUpgradePanel'

const OBSERVATION_SOURCE_META: Record<
  string,
  { label: string; detail: string }
> = {
  report: {
    label: 'Runtime report',
    detail: 'Stamped on the most recent user report (sdkPackage + sdkVersion).',
  },
  heartbeat: {
    label: 'SDK heartbeat',
    detail: 'Sent on every authenticated SDK request (X-Mushi-SDK-Version header).',
  },
  repo_scan: {
    label: 'Repo declared',
    detail: 'Read from package.json on GitHub (includes workspace:* monorepo packages).',
  },
  report_fallback: {
    label: 'Stamped report (fallback)',
    detail: 'Latest report with SDK fields — observation table not yet populated.',
  },
  upgrade_verify: {
    label: 'Upgrade job',
    detail: 'Recorded when an upgrade PR completed.',
  },
}

function shortPackage(pkg: string | null | undefined): string {
  return pkg?.replace(/^@mushi-mushi\//, '') ?? 'sdk'
}

function formatObservationSource(source: string | null | undefined): string {
  if (!source) return 'Not observed yet'
  const meta = OBSERVATION_SOURCE_META[source]
  return meta ? meta.label : source.replace(/_/g, ' ')
}

export function catalogPrSignalsConflict(
  project: BulkUpgradeProject,
  upgradeStatus: SdkUpgradeStatus | undefined,
): boolean {
  if (upgradeStatus !== 'completed_no_pr') return false
  const resolution = resolveSdkDisplay({
    observedVersion: project.sdk_version ?? null,
    latestVersion: project.sdk_latest_version ?? null,
    backendStatus: project.sdk_status,
    deprecated: project.sdk_status === 'deprecated',
  })
  return resolution.kind === 'upgrade-available'
}

export function buildFreshnessTooltip(
  project: BulkUpgradeProject,
  upgradeStatus?: SdkUpgradeStatus,
): MetricTooltipData {
  const pkg = project.sdk_package ?? '@mushi-mushi/web'
  const observed = project.sdk_version ?? '—'
  const catalog = project.sdk_latest_version ?? '—'
  const source = project.sdk_observation_source
  const sourceMeta = source ? OBSERVATION_SOURCE_META[source] : null
  const resolution = resolveSdkDisplay({
    observedVersion: project.sdk_version ?? null,
    latestVersion: project.sdk_latest_version ?? null,
    backendStatus: project.sdk_status,
    deprecated: project.sdk_status === 'deprecated',
  })

  const metadataLines = [
    `Package: ${pkg}`,
    `Observed: v${observed}`,
    `Catalog latest: v${catalog}`,
    `Observation: ${formatObservationSource(source)}`,
    project.sdk_status ? `Backend status: ${project.sdk_status}` : null,
  ].filter(Boolean)

  const sections: MetricTooltipData['sections'] = [
    {
      kind: 'shows',
      label: 'Catalog freshness',
      body:
        'Compares the SDK version we have on file for this project against the latest published @mushi-mushi/* version in our npm catalogue. Updates after reports, heartbeats, or a repo scan.',
    },
    {
      kind: 'counted',
      label: 'Metadata',
      body: metadataLines.join('\n'),
    },
  ]

  if (sourceMeta) {
    sections.push({
      kind: 'takeaway',
      label: 'How we know',
      body: sourceMeta.detail,
    })
  }

  let callout: MetricTooltipData['callout']

  if (resolution.kind === 'upgrade-available' && resolution.upgradeTarget) {
    callout = {
      tone: 'warn',
      text: `Running ${shortPackage(pkg)} v${observed}. npm catalogue recommends v${resolution.upgradeTarget}.`,
    }
  } else if (resolution.kind === 'catalog-ahead') {
    callout = {
      tone: 'ok',
      text: 'Observed version is ahead of the catalogue row — no downgrade needed.',
    }
  } else if (resolution.kind === 'up-to-date') {
    callout = { tone: 'ok', text: 'Matches the publish catalogue for this package.' }
  } else if (resolution.kind === 'unknown') {
    callout = {
      tone: 'info',
      text: 'Submit a report from the app or connect the SDK so we can observe a version.',
    }
  }

  if (catalogPrSignalsConflict(project, upgradeStatus)) {
    callout = {
      tone: 'info',
      text:
        'Catalog shows a newer npm release, but the upgrade job found nothing to bump (common for monorepos using workspace:*). Publish a new SDK version from the repo, or bump registry pins in host apps.',
    }
  }

  return { sections, callout }
}

export function buildPrJobTooltip(input: {
  status: SdkUpgradeStatus
  prUrl?: string
  error?: string
  plan?: BumpEntry[]
  releaseStatus?: string
  project?: BulkUpgradeProject
}): MetricTooltipData {
  const { status, prUrl, error, plan, releaseStatus, project } = input

  if (status === 'completed' && prUrl) {
    const bumpSummary =
      plan && plan.length > 0
        ? plan.map((b) => `${b.package}: ${b.from} → ${b.to}`).join('\n')
        : 'See the PR diff on GitHub.'
    return {
      sections: [
        {
          kind: 'shows',
          label: 'Upgrade PR',
          body: 'A draft PR was opened that bumps registry @mushi-mushi/* semver pins in package.json. Review, merge, then run install + redeploy the host app.',
        },
        {
          kind: 'counted',
          label: 'Planned bumps',
          body: bumpSummary,
        },
        {
          kind: 'takeaway',
          label: 'After the PR opens',
          body: '1. Review the PR on GitHub\n2. Refresh all — wait for CI green\n3. Merge all ready (or merge on GitHub)\n4. Install deps + redeploy the host app',
        },
      ],
      callout: releaseStatus === 'blocked'
        ? { tone: 'warn', text: 'CI is failing — fix checks on GitHub, then Sync again.' }
        : releaseStatus === 'ready_to_merge'
          ? { tone: 'ok', text: 'CI passed — use Merge PR here or on GitHub.' }
          : { tone: 'info', text: 'Use Refresh all in the panel header to update CI / deploy status from GitHub.' },
    }
  }

  if (status === 'completed_no_pr') {
    const conflict = project ? catalogPrSignalsConflict(project, status) : false
    return {
      sections: [
        {
          kind: 'shows',
          label: 'No PR created',
          body:
            'The upgrade worker scanned package.json on GitHub and found no registry semver pins to bump (already at latest, or only workspace:* / file: specifiers).',
        },
        {
          kind: 'counted',
          label: 'What this is not',
          body:
            'This does not mean the npm catalogue is current. It only means this button had nothing to change in package.json.',
        },
      ],
      callout: conflict
        ? {
            tone: 'info',
            text:
              'Monorepo? workspace:* deps are skipped. The amber catalog chip may still show a newer npm release — ship that via Changesets / publish in the SDK repo.',
          }
        : {
            tone: 'ok',
            text: error ?? 'Registry pins in package.json already match the latest npm versions.',
          },
    }
  }

  if (status === 'running' || status === 'queueing' || status === 'queued') {
    return {
      sections: [
        {
          kind: 'shows',
          label: 'Working',
          body: 'Reading package.json from the connected repo and opening a bump PR on GitHub.',
        },
      ],
    }
  }

  if (status === 'failed') {
    return {
      sections: [
        {
          kind: 'shows',
          label: 'Failed',
          body: error ?? 'The upgrade job did not complete. Check GitHub connection and retry.',
        },
      ],
      callout: { tone: 'warn', text: 'Click Retry to enqueue again.' },
    }
  }

  return {
    sections: [
      {
        kind: 'shows',
        label: 'Upgrade PR job',
        body: 'Opens a PR that bumps @mushi-mushi/* registry versions in the connected repo.',
      },
    ],
  }
}

export function buildReleaseStatusTooltip(
  releaseStatus: string,
  extras?: {
    checkRunConclusion?: string
    deployUrl?: string
    prUrl?: string
  },
): MetricTooltipData {
  const bodies: Record<string, string> = {
    pr_opened: 'Bump PR is open on GitHub. Use Refresh all in the panel header to pull the latest CI status.',
    blocked: 'A required CI check failed. Fix on GitHub, push, then Refresh all.',
    ready_to_merge: 'CI passed — safe to merge from here (Merge all ready) or on GitHub.',
    merging: 'Squash-merge in progress on GitHub.',
    merged: 'PR merged. Deploy may still be running — Refresh all to check.',
    deploying: 'Deploy workflow is running on GitHub.',
    deployed: 'Deploy finished. Ship the new build so the catalog chip can update.',
    verified: 'Post-merge SDK version verified in the repo.',
    failed: 'Release pipeline failed — open the PR on GitHub and inspect Actions.',
  }
  const metadata: string[] = []
  if (extras?.checkRunConclusion) metadata.push(`CI: ${extras.checkRunConclusion}`)
  if (extras?.deployUrl) metadata.push(`Deploy: ${extras.deployUrl}`)
  if (extras?.prUrl) metadata.push(`PR: ${extras.prUrl}`)

  const sections: MetricTooltipData['sections'] = [
    {
      kind: 'shows',
      label: 'After the PR opens',
      body: bodies[releaseStatus] ?? `Status: ${releaseStatus}`,
    },
  ]
  if (metadata.length > 0) {
    sections.push({ kind: 'counted', label: 'Latest from GitHub', body: metadata.join('\n') })
  }
  return { sections }
}

export function buildPanelLegendTooltip(): MetricTooltipData {
  return {
    sections: [
      {
        kind: 'shows',
        label: 'Catalog chip',
        body:
          'What SDK version is live (or declared) in this project vs the latest on npm — from reports, heartbeats, or a repo scan.',
      },
      {
        kind: 'shows',
        label: 'PR chip',
        body:
          'Whether we opened a package.json bump PR. “No PR needed” means nothing to bump (often workspace:* monorepos) — not that npm is current.',
      },
      {
        kind: 'takeaway',
        label: 'Typical flow',
        body: 'Open PRs → review on GitHub → Refresh all → Merge all ready → redeploy host apps.',
      },
    ],
    callout: {
      tone: 'info',
      text: 'Hover any chip for project-specific metadata.',
    },
  }
}

export function freshnessChipLabel(project: BulkUpgradeProject): {
  text: string
  prefix?: string
} {
  const resolution = resolveSdkDisplay({
    observedVersion: project.sdk_version ?? null,
    latestVersion: project.sdk_latest_version ?? null,
    backendStatus: project.sdk_status as SdkStatus | undefined,
    deprecated: project.sdk_status === 'deprecated',
  })

  if (resolution.kind === 'upgrade-available' && resolution.upgradeTarget) {
    return {
      prefix: 'Catalog',
      text: `v${project.sdk_version} → v${resolution.upgradeTarget}`,
    }
  }
  if (resolution.kind === 'up-to-date' && project.sdk_version) {
    return { prefix: 'Catalog', text: `v${project.sdk_version}` }
  }
  if (resolution.kind === 'catalog-ahead' && project.sdk_version) {
    return { prefix: 'Catalog', text: `v${project.sdk_version} (ahead)` }
  }
  if (resolution.kind === 'deprecated') {
    return { prefix: 'Catalog', text: 'Deprecated' }
  }
  return { prefix: 'Catalog', text: 'Unknown' }
}

export function prJobChipLabel(status: SdkUpgradeStatus): string {
  if (status === 'completed') return 'PR ready'
  if (status === 'completed_no_pr') return 'No PR needed'
  if (status === 'running') return 'Opening PR…'
  if (status === 'queueing' || status === 'queued') return 'Queuing…'
  if (status === 'failed') return 'PR failed'
  return status
}
