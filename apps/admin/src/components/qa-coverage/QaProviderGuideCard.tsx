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
import { qaProviderOverlay } from '../../lib/guideLiveOverlay'
import type { QaCoverageStats, QaCoverageTopPriority } from './QaCoverageStatsTypes'

interface Props {
  topPriority?: QaCoverageTopPriority
  stats?: Pick<QaCoverageStats, 'failingStories' | 'totalStories' | 'topPriority'>
}

export function QaProviderGuideCard({ topPriority, stats }: Props) {
  const needsGuidance =
    topPriority === 'no_stories' ||
    topPriority === 'no_project' ||
    topPriority === 'no_runs'

  const live = stats ?? {
    failingStories: 0,
    totalStories: 0,
    topPriority: topPriority ?? 'healthy',
  }

  return (
    <FeatureExplainPanel
      title="Which test runner should I pick?"
      summary={QA_COVERAGE_EXPLAINER_SUMMARY}
      defaultOpen={needsGuidance}
    >
      <div className="space-y-1">
        {QA_PROVIDER_DEFINITIONS.map((provider) => {
          const overlay = qaProviderOverlay(provider.id, live)
          return (
            <WorkflowStageRow
              key={provider.id}
              id={provider.id}
              shortLabel={provider.label}
              metric={overlay.metric ?? provider.tagline}
              posture={overlay.posture}
              plain={provider.tradeoffs}
              actionLine={overlay.actionLine ?? `Requires: ${provider.requires}`}
              examples={[provider.bestFor]}
            />
          )
        })}
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
