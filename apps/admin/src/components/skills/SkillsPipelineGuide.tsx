/**
 * Skill Pipelines guide — handoff vs cloud, catalog, sources. It sits at the
 * page foot, closed (console journeys 2026-10-27): the page opens on what is
 * running, and a bug is picked by its title, so no step copies an id.
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
  const live = stats ?? {
    activeRuns: 0,
    failedRuns: 0,
    awaitingCheckin: 0,
    topPriority: topPriority ?? 'healthy',
  }

  return (
    <FeatureExplainPanel
      title="How to run a skill on a bug"
      summary={SKILLS_EXPLAINER_SUMMARY}
      category="workflow"
      defaultOpen={false}
    >
      <div className="rounded-md border border-brand/20 bg-brand/5 px-3 py-2.5 space-y-1">
        <p className="text-2xs font-semibold text-fg">Example: fix a bug with workflow-fix-and-ship</p>
        <ol className="list-decimal pl-4 space-y-0.5 text-2xs text-fg-secondary">
          <li>Press <strong>Run a skill on a bug</strong> at the top, or open <Link to="/skills?tab=catalog&skill=workflow-fix-and-ship" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity">Catalog → workflow-fix-and-ship</Link></li>
          <li>Search for the bug by its title and pick it, choose Handoff, and press <strong>Start pipeline</strong></li>
          <li>Copy the context packet from Pipeline Runs into your editor's agent: it knows exactly what to fix</li>
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
        <Link to="/reports" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity">
          report
        </Link>{' '}
        — open any report, scroll to "Attach skill", pick a workflow and hit Start.
      </p>
    </FeatureExplainPanel>
  )
}
