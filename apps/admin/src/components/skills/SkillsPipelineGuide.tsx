/**
 * Visible Skill Pipelines guide — handoff vs cloud, catalog, sources.
 */

import { Link } from 'react-router-dom'
import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import {
  SKILLS_EXPLAINER_SUMMARY,
  SKILL_MODE_DEFINITIONS,
} from '../../lib/skillsExplainer'
import { skillsModeOverlay } from '../../lib/guideLiveOverlay'
import type { SkillsStats, SkillsTopPriority } from './SkillsStatsTypes'

interface Props {
  topPriority?: SkillsTopPriority
  stats?: Pick<
    SkillsStats,
    'activeRuns' | 'failedRuns' | 'awaitingCheckin' | 'topPriority'
  >
}

export function SkillsPipelineGuide({ topPriority, stats }: Props) {
  const needsGuidance =
    topPriority === 'no_project' ||
    topPriority === 'empty_catalog' ||
    topPriority === 'failed_runs' ||
    topPriority === 'awaiting_checkin'

  const live = stats ?? {
    activeRuns: 0,
    failedRuns: 0,
    awaitingCheckin: 0,
    topPriority: topPriority ?? 'healthy',
  }

  return (
    <FeatureExplainPanel
      title="How to apply a skill to a report"
      summary={SKILLS_EXPLAINER_SUMMARY}
      category="workflow"
      defaultOpen={needsGuidance}
    >
      <div className="rounded-md border border-brand/20 bg-brand/5 px-3 py-2.5 space-y-1">
        <p className="text-2xs font-semibold text-fg">Example: fix a bug with workflow-fix-and-ship</p>
        <ol className="list-decimal pl-4 space-y-0.5 text-2xs text-fg-secondary">
          <li>Open a report → copy its ID from the URL (e.g. <code className="font-mono bg-surface-overlay px-0.5 rounded">abc123de</code>)</li>
          <li>Go to <Link to="/skills?tab=catalog&skill=workflow-fix-and-ship" className="text-brand hover:underline">Catalog → workflow-fix-and-ship</Link></li>
          <li>Paste the report ID in "Report ID", choose Handoff mode, click <strong>Start pipeline</strong></li>
          <li>Copy the generated context packet into your local Cursor agent — it knows exactly what to fix</li>
        </ol>
      </div>

      <div className="space-y-1">
        {SKILL_MODE_DEFINITIONS.map((mode) => {
          const overlay = skillsModeOverlay(mode.id, live)
          return (
            <WorkflowStageRow
              key={mode.id}
              id={mode.id}
              shortLabel={mode.label}
              metric={overlay.metric}
              posture={overlay.posture}
              plain={mode.plain}
              actionLine={overlay.actionLine ?? `Best for: ${mode.bestFor}`}
              examples={[mode.requires]}
            />
          )
        })}
      </div>
      <ul className="list-disc pl-4 space-y-0.5 text-2xs text-fg-secondary">
        <li>
          <span className="font-medium text-fg">Catalog</span> — browse synced SKILL.md workflows by category
        </li>
        <li>
          <span className="font-medium text-fg">Pipelines</span> — watch step-by-step runs with live status
        </li>
        <li>
          <span className="font-medium text-fg">Sources</span> — add GitHub repos and sync the skill catalog
        </li>
      </ul>
      <p className="text-2xs text-fg-faint">
        You can also attach a skill directly from a{' '}
        <Link to="/reports" className="text-brand hover:underline">
          report
        </Link>{' '}
        — open any report, scroll to "Attach skill", pick a workflow and hit Start.
      </p>
    </FeatureExplainPanel>
  )
}
