/**
 * FILE: apps/admin/src/components/SdkVersionBadge.tsx
 * PURPOSE: Per-project SDK freshness pill rendered in the ProjectsPage
 *          row. Compares the latest *observed* SDK version (the package
 *          + version from the project's most recent report) against the
 *          latest *published* version in `public.sdk_versions`, and
 *          surfaces one of four states:
 *
 *              up-to-date   — observed === published latest
 *              outdated     — observed != latest (and latest exists)
 *              deprecated   — published latest is flagged deprecated
 *              unknown      — no report has landed yet, so we don't
 *                             know which package the project is running.
 *                             Render nothing (parent handles the empty
 *                             case via the "no reports yet" hint).
 *
 *          The badge is intentionally tiny — it lives in the metadata
 *          row alongside report-count / member-count and shouldn't
 *          out-shout the project name. The real explanation lives in
 *          a hover tooltip with an upgrade hint.
 *
 *          Authoritative data path:
 *              SDK report → reports.sdk_package / reports.sdk_version
 *              admin GET /v1/admin/projects → joins sdk_versions catalog
 *              FE consumes the resulting `sdk_status` field directly.
 */

import { Badge } from './ui'

export type SdkStatus = 'up-to-date' | 'outdated' | 'deprecated' | 'unknown'

interface SdkVersionBadgeProps {
  status: SdkStatus
  package_: string | null
  observedVersion: string | null
  latestVersion: string | null
  /** Catalogue-supplied deprecation message; only shown for `deprecated`. */
  deprecationMessage?: string | null
}

const STATUS_TONE: Record<Exclude<SdkStatus, 'unknown'>, string> = {
  'up-to-date': 'bg-ok-muted text-ok border border-ok/30',
  outdated: 'bg-warn-muted text-warn border border-warn/30',
  deprecated: 'bg-danger-muted text-danger border border-danger/30',
}

const STATUS_LABEL: Record<Exclude<SdkStatus, 'unknown'>, string> = {
  'up-to-date': 'SDK up to date',
  outdated: 'SDK outdated',
  deprecated: 'SDK deprecated',
}

export function SdkVersionBadge({
  status,
  package_,
  observedVersion,
  latestVersion,
  deprecationMessage,
}: SdkVersionBadgeProps) {
  // Quietly render nothing when we have no signal yet — the parent row
  // already shows "last report never", so a second "unknown" pill would
  // just be noise.
  if (status === 'unknown') return null

  const shortPackage = package_?.replace(/^@mushi-mushi\//, '') ?? 'sdk'

  const title = (() => {
    if (status === 'up-to-date') {
      return `Running ${package_ ?? 'the SDK'} v${observedVersion}, which matches the latest published version.`
    }
    if (status === 'outdated') {
      const left = `Running ${package_ ?? 'the SDK'} v${observedVersion}.`
      const right = latestVersion
        ? `Latest is v${latestVersion} — bump your dependency to pick up new fixes and features.`
        : 'A newer version is available — bump your dependency.'
      return `${left} ${right}`
    }
    // deprecated
    const dep = deprecationMessage ?? 'This package version has been deprecated.'
    return `Running ${package_ ?? 'the SDK'} v${observedVersion}. ${dep}${
      latestVersion ? ` Migrate to v${latestVersion}.` : ''
    }`
  })()

  return (
    <Badge className={STATUS_TONE[status]} title={title}>
      <span aria-hidden="true" className="mr-1">
        {status === 'up-to-date' ? '✓' : status === 'outdated' ? '↑' : '⚠'}
      </span>
      <span className="font-mono text-2xs">
        {shortPackage} v{observedVersion}
      </span>
      {status !== 'up-to-date' && latestVersion && (
        <span className="ml-1 text-2xs opacity-70">→ v{latestVersion}</span>
      )}
      <span className="sr-only">{STATUS_LABEL[status]}</span>
    </Badge>
  )
}
