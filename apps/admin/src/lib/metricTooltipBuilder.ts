/**
 * FILE: apps/admin/src/lib/metricTooltipBuilder.ts
 * PURPOSE: Shared builder for structured StatCard tooltips (Shows / Counted / Takeaway).
 */

import type { MetricTooltipCalloutTone, MetricTooltipData } from '../components/ui'

export function metricTip(
  shows: string,
  counted: string,
  takeaway: string,
  callout?: { tone?: MetricTooltipCalloutTone; text: string },
): MetricTooltipData {
  return {
    sections: [
      { label: 'Shows', kind: 'shows', body: shows },
      { label: 'Counted from', kind: 'counted', body: counted },
      { label: 'Takeaway', kind: 'takeaway', body: takeaway },
    ],
    ...(callout ? { callout } : {}),
  }
}
