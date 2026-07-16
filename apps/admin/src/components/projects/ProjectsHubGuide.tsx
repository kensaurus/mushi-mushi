/**
 * Visible projects hub health signals guide.
 */

import { Link } from 'react-router-dom'
import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import {
  PROJECTS_EXPLAINER_SUMMARY,
  PROJECTS_HEALTH_SIGNALS,
  isProjectsGuideExpanded,
} from '../../lib/projectsExplainer'
import { projectsHealthOverlay } from '../../lib/guideLiveOverlay'
import type { ProjectsStats, ProjectsTopPriority } from './types'

interface Props {
  topPriority?: ProjectsTopPriority
  stats?: Pick<
    ProjectsStats,
    | 'projectsWithReports'
    | 'sdkConnectedCount'
    | 'projectCount'
    | 'activeProjectHasReports'
    | 'activeProjectSdkConnected'
    | 'topPriority'
  >
}

export function ProjectsHubGuide({ topPriority, stats }: Props) {
  const live = stats ?? {
    projectsWithReports: 0,
    sdkConnectedCount: 0,
    projectCount: 0,
    activeProjectHasReports: false,
    activeProjectSdkConnected: false,
    topPriority: topPriority ?? 'healthy',
  }

  return (
    <FeatureExplainPanel
      title="What makes a project healthy"
      summary={PROJECTS_EXPLAINER_SUMMARY}
      defaultOpen={isProjectsGuideExpanded(topPriority)}
    >
      <div className="space-y-1">
        {PROJECTS_HEALTH_SIGNALS.map((signal) => {
          const overlay = projectsHealthOverlay(signal.id, live)
          return (
            <WorkflowStageRow
              key={signal.id}
              id={signal.id}
              shortLabel={signal.label}
              metric={overlay.metric}
              posture={overlay.posture}
              plain={signal.plain}
              actionLine={overlay.actionLine}
            />
          )
        })}
      </div>
      <p className="text-2xs text-fg-faint">
        First-time setup? Start on{' '}
        <Link to="/onboarding" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity">
          Get started
        </Link>{' '}
        or{' '}
        <Link to="/connect" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity">
          Connect
        </Link>
        .
      </p>
    </FeatureExplainPanel>
  )
}
