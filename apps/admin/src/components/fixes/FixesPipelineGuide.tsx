/**
 * Visible auto-fix lifecycle guide for the Fixes page.
 */

import { Link } from 'react-router-dom'
import { IconBolt, IconCheck, IconGit, IconPlay } from '../icons'
import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import {
  FIXES_EXPLAINER_SUMMARY,
  FIX_LIFECYCLE_STAGES,
  isFixesGuideExpanded,
} from '../../lib/fixesExplainer'
import { fixesStageOverlay } from '../../lib/guideLiveOverlay'
import type { FixesStats } from './FixesStatsTypes'

const STAGE_ICON: Record<string, typeof IconPlay> = {
  dispatch: IconPlay,
  draft_pr: IconGit,
  ci: IconBolt,
  merge: IconCheck,
}

interface Props {
  topPriority?: FixesStats['topPriority']
  stats?: Pick<
    FixesStats,
    | 'failed'
    | 'inProgress'
    | 'prsOpen'
    | 'prsCiPassing'
    | 'topPriority'
    | 'topPriorityLabel'
    | 'topPriorityTo'
  >
}

export function FixesPipelineGuide({ topPriority, stats }: Props) {
  const live = stats ?? {
    failed: 0,
    inProgress: 0,
    prsOpen: 0,
    prsCiPassing: 0,
    topPriority: topPriority ?? 'healthy',
    topPriorityLabel: null,
    topPriorityTo: null,
  }

  return (
    <FeatureExplainPanel
      title="Fix lifecycle — dispatch to merge"
      summary={FIXES_EXPLAINER_SUMMARY}
      category="workflow"
      defaultOpen={isFixesGuideExpanded(topPriority ?? live.topPriority)}
    >
      <div className="space-y-1">
        {FIX_LIFECYCLE_STAGES.map((stage) => {
          const overlay = fixesStageOverlay(stage.id, live)
          const Icon = STAGE_ICON[stage.id] ?? IconPlay
          return (
            <WorkflowStageRow
              key={stage.id}
              id={stage.id}
              shortLabel={stage.label}
              icon={<Icon size={14} />}
              metric={overlay.metric}
              posture={overlay.posture}
              actionLine={overlay.actionLine}
              actionHref={overlay.actionHref}
              plain={stage.plain}
              clearsWhen={stage.clearsWhen}
            />
          )
        })}
      </div>
      <p className="text-2xs text-fg-faint">
        Failed runs? Open the row for the error head, then retry or use{' '}
        <Link to="/mcp" className="text-brand hover:underline">
          MCP fix context
        </Link>{' '}
        in Cursor.
      </p>
    </FeatureExplainPanel>
  )
}
