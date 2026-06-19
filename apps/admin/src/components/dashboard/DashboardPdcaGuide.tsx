/**
 * Collapsible PDCA stage explainer for the dashboard hero area.
 */

import { Link } from 'react-router-dom'
import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import {
  DASHBOARD_PDCA_EXPLAINER_SUMMARY,
  dashboardStagePlain,
  isDashboardGuideExpanded,
} from '../../lib/dashboardExplainer'
import { dashboardStageOverlay } from '../../lib/guideLiveOverlay'
import { PDCA_STAGES, type PdcaStageId } from '../../lib/pdca'
import type { PdcaStage } from './types'

interface Props {
  stages?: PdcaStage[]
}

export function DashboardPdcaGuide({ stages = [] }: Props) {
  return (
    <FeatureExplainPanel
      title="Plan, Do, Check, Act — what each stage means"
      summary={DASHBOARD_PDCA_EXPLAINER_SUMMARY}
      category="workflow"
      defaultOpen={isDashboardGuideExpanded()}
    >
      <div className="space-y-1">
        {(Object.keys(PDCA_STAGES) as PdcaStageId[]).map((id) => {
          const meta = PDCA_STAGES[id]
          const live = stages.find((s) => s.id === id)
          const overlay = dashboardStageOverlay(id, live?.count ?? 0)
          return (
            <WorkflowStageRow
              key={id}
              id={id}
              shortLabel={meta.label}
              metric={overlay.metric}
              posture={overlay.posture}
              plain={dashboardStagePlain(id)}
            />
          )
        })}
      </div>
      <p className="text-2xs text-fg-faint">
        Full checklist with Ops stage on{' '}
        <Link to="/inbox" className="text-brand hover:underline">
          Inbox
        </Link>
        .
      </p>
    </FeatureExplainPanel>
  )
}
