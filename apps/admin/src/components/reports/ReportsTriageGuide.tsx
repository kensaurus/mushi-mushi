/**
 * Visible triage severity guide for the Reports page.
 */

import { Link } from 'react-router-dom'
import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import {
  REPORTS_TRIAGE_SUMMARY,
  TRIAGE_SEVERITY_DEFINITIONS,
} from '../../lib/reportsExplainer'
import { reportsSeverityOverlay } from '../../lib/guideLiveOverlay'
import type { ReportsStats, ReportsTopPriority } from './ReportsStatsTypes'

interface Props {
  topPriority?: ReportsTopPriority
  stats?: Pick<
    ReportsStats,
    'critical14d' | 'high14d' | 'newUntriaged' | 'openBacklog' | 'topPriority'
  >
}

export function ReportsTriageGuide({ topPriority, stats }: Props) {
  const live = stats ?? {
    critical14d: 0,
    high14d: 0,
    newUntriaged: 0,
    openBacklog: 0,
    topPriority: topPriority ?? 'clear',
  }

  return (
    <FeatureExplainPanel
      title="How severity and triage work"
      summary={REPORTS_TRIAGE_SUMMARY}
      category="guide"
      defaultOpen={false}
    >
      <div className="space-y-1 mb-3">
        {TRIAGE_SEVERITY_DEFINITIONS.map((sev) => {
          const overlay = reportsSeverityOverlay(sev.id, live)
          return (
            <WorkflowStageRow
              key={sev.id}
              id={sev.id}
              shortLabel={sev.label}
              metric={overlay.metric}
              posture={overlay.posture}
              plain={sev.plain}
              actionLine={overlay.actionLine ?? sev.triageHint}
            />
          )
        })}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-2xs">
          <thead>
            <tr className="border-b border-edge-subtle text-fg-faint uppercase tracking-wider">
              <th className="pb-2 pr-3 font-medium">Severity</th>
              <th className="pb-2 pr-3 font-medium">Means</th>
              <th className="pb-2 font-medium">What to do</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge-subtle">
            {TRIAGE_SEVERITY_DEFINITIONS.map((sev) => (
              <tr key={sev.id}>
                <td className="py-2 pr-3 align-top font-semibold text-fg whitespace-nowrap">
                  {sev.label}
                </td>
                <td className="py-2 pr-3 align-top text-fg-muted max-w-[12rem]">{sev.plain}</td>
                <td className="py-2 align-top text-fg-secondary">{sev.triageHint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-2xs text-fg-faint">
        After triage, dispatch fixes from a report row or bulk-select several. Track PR progress on{' '}
        <Link to="/fixes" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-colors">
          Fixes
        </Link>
        .
      </p>
    </FeatureExplainPanel>
  )
}
