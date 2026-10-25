import type { ReportDetail } from './types'

/**
 * Sentry-style "best-effort capture" messaging. Distinguishes between:
 *  - the platform/SDK *cannot* capture a signal (e.g. RN needs an optional dep
 *    for screenshots), vs
 *  - the SDK *can* capture it but nothing was recorded this time.
 *
 * Keeps empty states honest instead of always nudging "Upgrade the SDK" — the
 * report at hand may be from a current SDK that simply had no interactions.
 */

const NATIVE_SDK_RE = /(react-native|capacitor|expo|ios|android|flutter|swift|kotlin)/i

function isNativeSdk(report: Pick<ReportDetail, 'sdk_package'>): boolean {
  return !!report.sdk_package && NATIVE_SDK_RE.test(report.sdk_package)
}

/** True when the report carries any SDK telemetry stamp (modern SDK). */
function hasSdkStamp(report: Pick<ReportDetail, 'sdk_package' | 'sdk_version'>): boolean {
  return !!(report.sdk_package || report.sdk_version)
}

export function screenshotEmptyText(
  report: Pick<ReportDetail, 'sdk_package' | 'sdk_version'>,
): string {
  if (isNativeSdk(report)) {
    return 'No screenshot — native screen capture needs the optional react-native-view-shot dependency, or the reporter removed it before sending.'
  }
  if (hasSdkStamp(report)) {
    return 'No screenshot was attached to this report (the reporter may have removed it).'
  }
  return 'No screenshot was captured for this report.'
}

export interface CapturedEvidence {
  performance: boolean
  console: boolean
  network: boolean
  repro: boolean
}

/**
 * Which capture panels have something to show. Empty panels used to each
 * render a full card ("No console output…"), so a quiet report was four
 * blank tiles (NN/g #8). Absent streams collapse to one line instead.
 */
export function capturedEvidence(
  report: Pick<ReportDetail, 'performance_metrics' | 'console_logs' | 'network_logs' | 'repro_timeline'> & {
    backend_spans?: ReportDetail['backend_spans']
  },
): CapturedEvidence {
  const metrics = report.performance_metrics
  return {
    performance: !!metrics && Object.keys(metrics).length > 0,
    console: (report.console_logs?.length ?? 0) > 0,
    network: (report.network_logs?.length ?? 0) > 0 || (report.backend_spans?.length ?? 0) > 0,
    repro: Array.isArray(report.repro_timeline) && report.repro_timeline.length > 0,
  }
}

const ABSENT_LABEL: Record<keyof CapturedEvidence, string> = {
  console: 'console logs',
  network: 'network',
  performance: 'performance',
  repro: 'repro timeline',
}

const ABSENT_ORDER: Array<keyof CapturedEvidence> = ['console', 'network', 'performance', 'repro']

export function uncapturedEvidenceNote(flags: CapturedEvidence): string | null {
  const missing = ABSENT_ORDER.filter((key) => !flags[key]).map((key) => ABSENT_LABEL[key])
  if (missing.length === 0) return null
  return `Not captured: ${joinAnd(missing)}.`
}

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

export function timelineEmpty(
  report: Pick<ReportDetail, 'sdk_package' | 'sdk_version'>,
): { title: string; description: string } {
  if (hasSdkStamp(report)) {
    return {
      title: 'No repro timeline',
      description: isNativeSdk(report)
        ? 'No screen changes, taps, or logs were recorded before this report. Call mushi.setScreen() on navigation to enrich the trail.'
        : 'No route changes, clicks, logs, or requests were recorded in the moments before this report.',
    }
  }
  return {
    title: 'No repro timeline',
    description: 'Upgrade the SDK to capture route changes, clicks, logs, and requests in one chronological trail.',
  }
}
