/**
 * Plain-language QA Coverage provider choice guide.
 */

export type QaProviderId = 'firecrawl_actions' | 'browserbase' | 'local'

export interface QaProviderDefinition {
  id: QaProviderId
  label: string
  tagline: string
  bestFor: string
  requires: string
  tradeoffs: string
}

export const QA_PROVIDER_DEFINITIONS: QaProviderDefinition[] = [
  {
    id: 'firecrawl_actions',
    label: 'Firecrawl (default)',
    tagline: 'Cloud HTTP checks — no setup',
    bestFor: 'Content verification, basic navigation, and smoke tests that do not need a full browser.',
    requires: 'Nothing extra — works out of the box. Optional BYOK Firecrawl key in Settings for higher limits.',
    tradeoffs: 'No full Playwright API — complex clicks and multi-step flows may need Browserbase or local.',
  },
  {
    id: 'browserbase',
    label: 'Browserbase',
    tagline: 'Remote Chromium with screenshots',
    bestFor: 'CI-like confidence for login flows, modals, and multi-step UI without running infra yourself.',
    requires: 'Browserbase API key under Settings → Cloud browser. Charged to your Browserbase account.',
    tradeoffs: 'Slightly slower cold starts; best for stories that need real browser interactions.',
  },
  {
    id: 'local',
    label: 'Local Playwright',
    tagline: 'Full Playwright on your machine',
    bestFor: 'TDD-generated tests, debugging failures locally, and flows that need filesystem or native APIs.',
    requires: 'Run via CLI (`mushi qa run`) — not schedulable from the cloud runner.',
    tradeoffs: 'Does not run on the hourly cron unless you wire your own CI to trigger runs.',
  },
]

export const QA_COVERAGE_EXPLAINER_SUMMARY =
  'Each QA story is a user-flow test that runs on a schedule. Pick Firecrawl for quick smoke checks, Browserbase for full browser flows in the cloud, or local Playwright when you need maximum control.'

export function qaProviderDefinition(provider: string): QaProviderDefinition | undefined {
  return QA_PROVIDER_DEFINITIONS.find((p) => p.id === provider)
}
