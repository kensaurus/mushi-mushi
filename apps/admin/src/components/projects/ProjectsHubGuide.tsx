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
import type { ProjectsTopPriority } from './types'

interface Props {
  topPriority?: ProjectsTopPriority
}

export function ProjectsHubGuide({ topPriority }: Props) {
  return (
    <FeatureExplainPanel
      title="What makes a project healthy"
      summary={PROJECTS_EXPLAINER_SUMMARY}
      defaultOpen={isProjectsGuideExpanded(topPriority)}
    >
      <div className="space-y-1">
        {PROJECTS_HEALTH_SIGNALS.map((signal) => (
          <WorkflowStageRow
            key={signal.id}
            id={signal.id}
            shortLabel={signal.label}
            posture="info"
            plain={signal.plain}
          />
        ))}
      </div>
      <p className="text-2xs text-fg-faint">
        First-time setup? Start on{' '}
        <Link to="/onboarding" className="text-brand hover:underline">
          Get started
        </Link>{' '}
        or{' '}
        <Link to="/connect" className="text-brand hover:underline">
          Connect
        </Link>
        .
      </p>
    </FeatureExplainPanel>
  )
}
