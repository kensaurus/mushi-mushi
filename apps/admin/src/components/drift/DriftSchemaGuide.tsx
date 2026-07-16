/**
 * Visible schema / contract drift guide for the Drift page.
 */

import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import {
  DRIFT_EXPLAINER_SUMMARY,
  DRIFT_SEVERITY_DEFINITIONS,
  isDriftGuideExpanded,
} from '../../lib/driftExplainer'
import { driftSeverityOverlay } from '../../lib/guideLiveOverlay'
import type { DriftStats, DriftTopPriority } from './DriftStatsTypes'

interface Props {
  topPriority?: DriftTopPriority
  stats?: Pick<
    DriftStats,
    'criticalOpen' | 'warnOpen' | 'infoOpen' | 'topPriority'
  >
}

export function DriftSchemaGuide({ topPriority, stats }: Props) {
  const live = stats ?? {
    criticalOpen: 0,
    warnOpen: 0,
    infoOpen: 0,
    topPriority: topPriority ?? 'healthy',
  }

  return (
    <FeatureExplainPanel
      title="What schema drift means"
      summary={DRIFT_EXPLAINER_SUMMARY}
      defaultOpen={isDriftGuideExpanded(topPriority)}
      category="guide"
    >
      <div className="space-y-1 mb-3">
        {DRIFT_SEVERITY_DEFINITIONS.map((sev) => {
          const overlay = driftSeverityOverlay(sev.id, live)
          return (
            <WorkflowStageRow
              key={sev.id}
              id={sev.id}
              shortLabel={sev.label}
              metric={overlay.metric}
              posture={overlay.posture}
              plain={sev.plain}
              actionLine={sev.example}
            />
          )
        })}
      </div>
      <div className="overflow-x-auto">
        // mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas)
        <table className="w-full min-w-[28rem] text-left text-2xs">
          <thead>
            <tr className="border-b border-edge-subtle text-fg-faint uppercase tracking-wider">
              <th className="pb-2 pr-3 font-medium">Severity</th>
              <th className="pb-2 pr-3 font-medium">Means</th>
              <th className="pb-2 font-medium">Example</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge-subtle">
            {DRIFT_SEVERITY_DEFINITIONS.map((sev) => (
              <tr key={sev.id}>
                <td className="py-2 pr-3 align-top font-semibold text-fg whitespace-nowrap">
                  {sev.label}
                </td>
                <td className="py-2 pr-3 align-top text-fg-muted max-w-56">{sev.plain}</td>
                <td className="py-2 align-top text-fg-secondary">{sev.example}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </FeatureExplainPanel>
  )
}
