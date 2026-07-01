/**
 * Visible intro for the active Settings tab — what it does and what it affects.
 */

import { Link } from 'react-router-dom'
import { SETTINGS_TAB_EXPLAINERS, type SettingsTabExplainer } from '../../lib/settingsTabExplainer'
import type { SettingsTabId } from './types'
import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { WorkflowStageRow } from '../workflow/WorkflowStageRow'
import { settingsTabOverlay } from '../../lib/guideLiveOverlay'

interface SettingsTabFlags {
  hasByokKey?: boolean
  slackConfigured?: boolean
  githubConfigured?: boolean
}

interface Props {
  tab: SettingsTabId
  flags?: SettingsTabFlags
}

export function SettingsTabIntro({ tab, flags }: Props) {
  const explainer: SettingsTabExplainer = SETTINGS_TAB_EXPLAINERS[tab]
  const overlay = settingsTabOverlay(tab, flags ?? {})

  return (
    <FeatureExplainPanel
      title={explainer.title}
      summary={explainer.summary}
      category="guide"
      variant="inset"
      defaultOpen={false}
    >
      <WorkflowStageRow
        id={`settings-${tab}`}
        shortLabel="This tab"
        metric={overlay.metric}
        posture={overlay.posture}
        plain={explainer.summary}
        actionLine={overlay.actionLine}
      />
      <div>
        <p className="mb-1.5 text-3xs font-semibold uppercase tracking-wider text-fg-faint">
          What you are configuring
        </p>
        <ul className="list-disc pl-4 space-y-1 text-2xs text-fg-secondary">
          {explainer.affects.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <p className="text-2xs text-fg-faint">
        Each field has an{' '}
        <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-edge align-middle text-3xs font-serif italic">
          i
        </span>{' '}
        icon — click it for defaults, backend details, and when to change a value.{' '}
        {tab === 'byok' && (
          <>
            See also{' '}
            <Link to="/billing" className="text-brand hover:underline">
              Billing
            </Link>{' '}
            for plan limits.
          </>
        )}
      </p>
    </FeatureExplainPanel>
  )
}
