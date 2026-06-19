/**
 * Visible provider choice guide for QA Coverage stories.
 */

import { Link } from 'react-router-dom'
import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import {
  QA_COVERAGE_EXPLAINER_SUMMARY,
  QA_PROVIDER_DEFINITIONS,
} from '../../lib/qaProviderGuide'
import type { QaCoverageTopPriority } from './QaCoverageStatsTypes'

interface Props {
  topPriority?: QaCoverageTopPriority
}

export function QaProviderGuideCard({ topPriority }: Props) {
  const needsGuidance =
    topPriority === 'no_stories' ||
    topPriority === 'no_project' ||
    topPriority === 'no_runs'

  return (
    <FeatureExplainPanel
      title="Which test runner should I pick?"
      summary={QA_COVERAGE_EXPLAINER_SUMMARY}
      defaultOpen={needsGuidance}
    >
      <div className="space-y-1">
        {QA_PROVIDER_DEFINITIONS.map((provider) => (
          <WorkflowStageRow
            key={provider.id}
            id={provider.id}
            shortLabel={provider.label}
            posture="info"
            metric={provider.tagline}
            plain={provider.tradeoffs}
            actionLine={`Requires: ${provider.requires}`}
            examples={[provider.bestFor]}
          />
        ))}
      </div>
      <p className="text-2xs text-fg-faint">
        Add Browserbase or Firecrawl keys under{' '}
        <Link to="/settings?tab=browserbase" className="text-brand hover:underline">
          Settings
        </Link>
        . TDD-generated tests default to local Playwright until you approve and pick a provider.
      </p>
    </FeatureExplainPanel>
  )
}
