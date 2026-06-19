/**
 * Visible PDCA stage guide for the Action Inbox.
 */

import {
  IconFixes,
  IconGauge,
  IconHealth,
  IconReports,
  IconSettings,
} from '../icons'
import { INBOX_EXPLAINER_SUMMARY, INBOX_PDCA_STAGES } from '../../lib/inboxExplainer'
import { inboxStageOverlay } from '../../lib/guideLiveOverlay'
import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import type { InboxStats } from './types'

const STAGE_ICON: Record<string, typeof IconReports> = {
  plan: IconReports,
  do: IconFixes,
  check: IconGauge,
  act: IconSettings,
  ops: IconHealth,
}

interface Props {
  stats: Pick<InboxStats, 'topPriority' | 'openPlan' | 'openDo' | 'openCheck' | 'openAct' | 'openOps'>
}

export function InboxPdcaGuide({ stats }: Props) {
  return (
    <FeatureExplainPanel
      title="What Plan, Do, Check, Act, and Ops mean"
      summary={INBOX_EXPLAINER_SUMMARY}
      category="workflow"
      defaultOpen={false}
    >
      <div className="space-y-1">
        {INBOX_PDCA_STAGES.map((stage) => {
          const overlay = inboxStageOverlay(stage.id, stats)
          const Icon = STAGE_ICON[stage.id] ?? IconReports
          return (
            <WorkflowStageRow
              key={stage.id}
              id={stage.id}
              shortLabel={stage.shortLabel}
              icon={<Icon size={14} />}
              metric={overlay.metric}
              posture={overlay.posture}
              actionLine={overlay.actionLine}
              actionHref={overlay.actionHref}
              plain={stage.plain}
              clearsWhen={stage.clearsWhen}
              examples={stage.examples}
            />
          )
        })}
      </div>
    </FeatureExplainPanel>
  )
}
