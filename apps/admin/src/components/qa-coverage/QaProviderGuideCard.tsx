/**
 * Provider choice guide for Scheduled tests (QA Coverage stories).
 *
 * Round-2 sweep 2026-11-18: the guide opened by default above the empty state
 * (~450px of three tinted cards, the default Firecrawl one amber, each chip
 * saying "No stories"), pushing "+ New story" off the first screen, and the
 * CLI command printed with raw backticks. It is now collapsed, sits under the
 * call to action, and lists the three runners as plain neutral rows: choosing
 * a runner is not a warning, and "no stories" is said once, by the empty state.
 */

import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { FeatureExplainPanel } from '../FeatureExplainPanel'
import { QA_COVERAGE_EXPLAINER_SUMMARY, QA_PROVIDER_DEFINITIONS } from '../../lib/qaProviderGuide'

/** Render `inline code` spans from guide copy as <code>, never as raw backticks. */
export function renderInlineCode(text: string): ReactNode {
  const parts = text.split('`')
  if (parts.length < 3) return text
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="rounded-sm bg-surface-overlay px-1 font-mono text-[0.95em] text-fg">
        {part}
      </code>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  )
}

export function QaProviderGuideCard() {
  return (
    <FeatureExplainPanel title="Which test runner should I pick?" summary={QA_COVERAGE_EXPLAINER_SUMMARY} defaultOpen={false}>
      <ul className="divide-y divide-edge-subtle" data-testid="qa-provider-guide-list">
        {QA_PROVIDER_DEFINITIONS.map((provider) => (
          <li key={provider.id} className="py-2 first:pt-0 last:pb-0">
            <p className="text-xs text-fg">
              <span className="font-semibold">{provider.label}</span>
              <span className="text-fg-muted"> · {provider.tagline}</span>
            </p>
            <p className="mt-0.5 text-2xs text-fg-secondary">{provider.bestFor}</p>
            <p className="mt-0.5 text-2xs text-fg-muted">
              <span className="font-medium text-fg-secondary">Needs:</span> {renderInlineCode(provider.requires)}
            </p>
          </li>
        ))}
      </ul>
      <p className="text-2xs text-fg-faint">
        Add Browserbase or Firecrawl keys under{' '}
        <Link to="/settings?tab=byok#key-browserbase" className="text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-opacity">
          Settings → AI keys
        </Link>
        . TDD-generated tests default to local Playwright until you approve and pick a provider.
      </p>
    </FeatureExplainPanel>
  )
}
