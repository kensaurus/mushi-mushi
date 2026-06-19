/**
 * Visible Atlas tab guide for the Explore codebase page.
 */

import { Link } from 'react-router-dom'
import { EXPLORE_ATLAS_TABS, EXPLORE_EXPLAINER_SUMMARY } from '../../lib/exploreExplainer'
import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import type { ExploreTopPriority } from './ExploreStatsTypes'

interface Props {
  topPriority?: ExploreTopPriority
}

export function ExploreAtlasGuide({ topPriority }: Props) {
  const needsGuidance =
    topPriority === 'not_enabled' ||
    topPriority === 'empty' ||
    topPriority === 'error' ||
    topPriority === 'no_project' ||
    topPriority === 'indexing'

  return (
    <FeatureExplainPanel
      title="What each Explore tab does"
      summary={EXPLORE_EXPLAINER_SUMMARY}
      defaultOpen={needsGuidance}
    >
      <div className="space-y-1">
        {EXPLORE_ATLAS_TABS.map((tab) => (
          <WorkflowStageRow
            key={tab.id}
            id={tab.id}
            shortLabel={tab.label}
            posture="info"
            plain={tab.plain}
            actionLine={tab.whenToUse}
          />
        ))}
      </div>
      <p className="text-2xs text-fg-faint">
        Index not working? Open the{' '}
        <Link to="/explore?tab=index" className="text-brand hover:underline">
          Index
        </Link>{' '}
        tab or connect your repo on{' '}
        <Link to="/connect" className="text-brand hover:underline">
          Connect
        </Link>
        .
      </p>
    </FeatureExplainPanel>
  )
}
