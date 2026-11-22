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
  /**
   * Inside the "How a fix starts" card (round-2 review): a plain disclosure
   * under its Autofix step, not a second bordered panel repeating it.
   */
  flat?: boolean
}

export function FixesPipelineGuide({ topPriority, stats, flat = false }: Props) {
  const live = stats ?? {
    failed: 0,
    inProgress: 0,
    prsOpen: 0,
    prsCiPassing: 0,
    topPriority: topPriority ?? 'healthy',
    topPriorityLabel: null,
    topPriorityTo: null,
  }

  const stages = (
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
  )

  if (flat) {
    return (
      <details className="group text-xs" open={isFixesGuideExpanded(topPriority ?? live.topPriority)} data-testid="fixes-autofix-how">
        <summary className="cursor-pointer select-none text-2xs font-medium text-fg-muted hover:text-fg">How Autofix works</summary>
        <div className="mt-2 space-y-2">
          <p className="text-2xs leading-relaxed text-fg-muted">{FIXES_EXPLAINER_SUMMARY}</p>
          {stages}
        </div>
      </details>
    )
  }

  return (
    <FeatureExplainPanel
      title="How Autofix works (optional)"
      summary={FIXES_EXPLAINER_SUMMARY}
      category="workflow"
      defaultOpen={isFixesGuideExpanded(topPriority ?? live.topPriority)}
    >
      {stages}
      <p className="text-2xs text-fg-faint">
        Failed runs? Open the row for the error head, then retry or use{' '}
        <Link to="/mcp" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity">
          MCP fix context
        </Link>{' '}
        in Cursor.
      </p>
    </FeatureExplainPanel>
  )
}
