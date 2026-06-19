/**
 * FILE: apps/admin/src/lib/projectMetaTooltips.ts
 * PURPOSE: Structured tooltip copy for project switcher metadata chips.
 */

import type { MetricTooltipData } from '../components/ui'
import type { SetupProject } from './useSetupStatus'
import type { ProjectSnapshot } from './projectSnapshotTypes'

export function buildProjectSetupTooltip(project: SetupProject): MetricTooltipData {
  const incomplete = project.steps.filter((s) => s.required && !s.complete)
  return {
    sections: [
      {
        kind: 'shows',
        label: 'Reports ingested',
        body: `${project.report_count} bug report${project.report_count === 1 ? '' : 's'} have landed for this project across all time.`,
      },
      {
        kind: 'counted',
        label: 'Setup checklist',
        body: `${project.required_complete} of ${project.required_total} required steps complete (${project.complete}/${project.total} total including optional wiring).`,
      },
      ...(incomplete.length > 0
        ? [
            {
              kind: 'takeaway' as const,
              label: 'Still required',
              body: incomplete.map((s) => s.label).join(' · '),
            },
          ]
        : []),
    ],
    callout:
      project.done
        ? { tone: 'ok' as const, text: 'Required setup is complete for this project.' }
        : { tone: 'warn' as const, text: 'Finish required setup so triage and auto-fix can run end-to-end.' },
  }
}

export function buildTrendTooltip(snapshot: ProjectSnapshot): MetricTooltipData | null {
  const trend = snapshot.trend_7d
  if (!trend) return null
  return {
    sections: [
      {
        kind: 'shows',
        label: 'Last 7 days',
        body: `${trend.last7d} report${trend.last7d === 1 ? '' : 's'} ingested in the rolling 7-day window.`,
      },
      {
        kind: 'counted',
        label: 'Prior 7 days',
        body: `${trend.prev7d} report${trend.prev7d === 1 ? '' : 's'} in the week before that.`,
      },
      {
        kind: 'takeaway',
        label: 'Trend',
        body:
          trend.direction === 'up'
            ? `Volume is up by ${trend.delta} — more user-felt bugs than the prior week.`
            : trend.direction === 'down'
              ? `Volume is down by ${Math.abs(trend.delta)} — quieter than the prior week.`
              : 'Volume is flat week-over-week.',
      },
    ],
  }
}

export function buildCriticalTooltip(count: number): MetricTooltipData {
  return {
    sections: [
      {
        kind: 'shows',
        label: 'Critical severity',
        body: `${count} report${count === 1 ? '' : 's'} tagged critical in the last 30 days for this project.`,
      },
      {
        kind: 'takeaway',
        label: 'Action',
        body: 'Open Reports and filter by severity — critical items should be triaged first.',
      },
    ],
    callout: { tone: 'warn', text: 'Critical bugs block user workflows — prioritize these in Plan.' },
  }
}

export function buildBottleneckTooltip(
  stage: string,
  label: string,
): MetricTooltipData {
  return {
    sections: [
      {
        kind: 'shows',
        label: 'PDCA bottleneck',
        body: `This project is most stuck at the ${stage.toUpperCase()} stage right now.`,
      },
      { kind: 'takeaway', label: 'Detail', body: label },
    ],
    callout: {
      tone: 'info',
      text: 'Click to open the page that clears this — failed fixes go straight to the Failed tab.',
    },
  }
}
