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

export function isNativeSdk(report: Pick<ReportDetail, 'sdk_package'>): boolean {
  return !!report.sdk_package && NATIVE_SDK_RE.test(report.sdk_package)
}

/** True when the report carries any SDK telemetry stamp (modern SDK). */
export function hasSdkStamp(report: Pick<ReportDetail, 'sdk_package' | 'sdk_version'>): boolean {
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
