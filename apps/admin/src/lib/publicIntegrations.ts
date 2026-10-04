/**
 * FILE: apps/admin/src/lib/publicIntegrations.ts
 * PURPOSE: The integrations listed on the public /integrations page, and where
 *          each one's docs live.
 *
 * Docs links used to be derived from the display name
 * (`/integrations/<name>`), a folder that only holds cursor and voice-intake,
 * so every tile's "Docs" link 404'd. Inbound adapters are documented together
 * on the adapters page, outbound plugins each have a page under /plugins, and
 * a test checks every plugin slug against apps/docs/content/plugins.
 */

export const PUBLIC_DOCS_BASE = 'https://kensaur.us/mushi-mushi/docs'
export const PUBLIC_REPO_BASE = 'https://github.com/kensaurus/mushi-mushi'

/** The plugin SDK's docs page and source (the default branch is master). */
export const PLUGIN_SDK_DOCS_URL = `${PUBLIC_DOCS_BASE}/sdks/plugin-sdk`
export const PLUGIN_SDK_REPO_URL = `${PUBLIC_REPO_BASE}/tree/master/packages/plugin-sdk`

/** Docs page slug under /plugins for an outbound plugin's display name. */
function pluginDocsSlug(name: string): string {
  if (name === 'MS Teams') return 'msteams'
  return name.toLowerCase().replace(/\s+/g, '-')
}

/** The docs page for one integration tile. */
export function integrationDocsHref(integration: Pick<Integration, 'name' | 'direction'>): string {
  if (integration.direction === 'inbound') return `${PUBLIC_DOCS_BASE}/sdks/adapters`
  if (integration.direction === 'sdk') return PLUGIN_SDK_DOCS_URL
  return `${PUBLIC_DOCS_BASE}/plugins/${pluginDocsSlug(integration.name)}`
}

// ─── Integration data ──────────────────────────────────────────────────────

export type Category =
  | 'All'
  | 'Error Monitoring'
  | 'APM & Telemetry'
  | 'Analytics'
  | 'Chat & Notifications'
  | 'Project Management'
  | 'Mobile'

export interface Integration {
  name: string
  /**
   * Simple Icons slug for the brand mark, bundled at
   * `public/brand/platforms/<mark>.svg`. Omit for first-party entries
   * (Plugin SDK) and for brands with no CC0 mark (Honeycomb) — those render
   * the Mushi mark rather than a letter block.
   *
   * Bundled rather than fetched: the admin CSP allows `https://www.google.com`
   * but the favicon endpoint 301s to `t{0..3}.gstatic.com`, which CSP
   * re-checks and blocks — so the CDN approach silently rendered nothing but
   * fallbacks in production. Local assets also keep visitor IPs off a third
   * party on a public, unauthenticated marketing page.
   */
  mark?: string
  pkg: string
  direction: 'inbound' | 'outbound' | 'sdk'
  category: Exclude<Category, 'All'>
  description: string
}

export const INTEGRATIONS: Integration[] = [
  // ── Inbound adapters ──────────────────────────────────────────────────
  {
    name: 'Datadog',
    mark: 'datadog',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'APM & Telemetry',
    description: 'Forward APM alerts and metric spikes as Mushi reports.',
  },
  {
    name: 'New Relic',
    mark: 'newrelic',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'APM & Telemetry',
    description: 'Route New Relic incident alerts to the Mushi report feed.',
  },
  {
    name: 'Honeycomb',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'APM & Telemetry',
    description: 'Pipe Honeycomb query triggers in for user-felt correlation.',
  },
  {
    name: 'Grafana Loki',
    mark: 'grafana',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'APM & Telemetry',
    description: 'Forward Loki log alerts as enriched Mushi reports.',
  },
  {
    name: 'CloudWatch',
    mark: 'amazonwebservices',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'APM & Telemetry',
    description: 'Import AWS CloudWatch alarms directly into Mushi.',
  },
  {
    name: 'Sentry',
    mark: 'sentry',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'Error Monitoring',
    description: 'Import Sentry issue webhooks with stack traces intact.',
  },
  {
    name: 'Bugsnag',
    mark: 'bugsnag',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'Error Monitoring',
    description: 'Receive Bugsnag error alerts and map them to user reports.',
  },
  {
    name: 'Rollbar',
    mark: 'rollbar',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'Error Monitoring',
    description: 'Send Rollbar occurrences into your Mushi reports inbox.',
  },
  {
    name: 'Crashlytics',
    mark: 'firebase',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'Mobile',
    description: 'Pull Firebase Crashlytics crashes into the report feed.',
  },
  {
    name: 'Firebase Analytics',
    mark: 'firebase',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'Analytics',
    description: 'Correlate funnel-drop events with user-felt friction.',
  },
  {
    name: 'OpsGenie',
    mark: 'opsgenie',
    pkg: '@mushi-mushi/adapters',
    direction: 'inbound',
    category: 'Project Management',
    description: 'Convert OpsGenie alerts into triaged Mushi reports.',
  },
  // ── Outbound plugins ──────────────────────────────────────────────────
  {
    name: 'Sentry',
    mark: 'sentry',
    pkg: '@mushi-mushi/plugin-sentry',
    direction: 'outbound',
    category: 'Error Monitoring',
    description: 'Resolve Sentry issues when Mushi fixes land in production.',
  },
  {
    name: 'Bugsnag',
    mark: 'bugsnag',
    pkg: '@mushi-mushi/plugin-bugsnag',
    direction: 'outbound',
    category: 'Error Monitoring',
    description: 'Close Bugsnag errors when Mushi confirms the fix is live.',
  },
  {
    name: 'Rollbar',
    mark: 'rollbar',
    pkg: '@mushi-mushi/plugin-rollbar',
    direction: 'outbound',
    category: 'Error Monitoring',
    description: 'Mark Rollbar items resolved when Mushi deploys a fix.',
  },
  {
    name: 'Crashlytics',
    mark: 'firebase',
    pkg: '@mushi-mushi/plugin-crashlytics',
    direction: 'outbound',
    category: 'Mobile',
    description: 'Sync crash resolution status back to Firebase Crashlytics.',
  },
  {
    name: 'Slack',
    mark: 'slack',
    pkg: '@mushi-mushi/plugin-slack-app',
    direction: 'outbound',
    category: 'Chat & Notifications',
    description: 'Post report digests and plain-English read summaries to Slack.',
  },
  {
    name: 'Discord',
    mark: 'discord',
    pkg: '@mushi-mushi/plugin-discord',
    direction: 'outbound',
    category: 'Chat & Notifications',
    description: 'Deliver report alerts and fix summaries to Discord channels.',
  },
  {
    name: 'MS Teams',
    mark: 'microsoftteams',
    pkg: '@mushi-mushi/plugin-msteams',
    direction: 'outbound',
    category: 'Chat & Notifications',
    description: 'Route Mushi alerts to Microsoft Teams channels.',
  },
  {
    name: 'Jira',
    mark: 'jira',
    pkg: '@mushi-mushi/plugin-jira',
    direction: 'outbound',
    category: 'Project Management',
    description: 'Create Jira tickets automatically from triaged reports.',
  },
  {
    name: 'Linear',
    mark: 'linear',
    pkg: '@mushi-mushi/plugin-linear',
    direction: 'outbound',
    category: 'Project Management',
    description: 'Push triaged bugs and fix tasks to Linear cycles.',
  },
  {
    name: 'PagerDuty',
    mark: 'pagerduty',
    pkg: '@mushi-mushi/plugin-pagerduty',
    direction: 'outbound',
    category: 'Project Management',
    description: 'Trigger PagerDuty incidents for critical user-reported issues.',
  },
  {
    name: 'GitHub Issues',
    mark: 'github',
    pkg: '@mushi-mushi/plugin-github-issues',
    direction: 'outbound',
    category: 'Project Management',
    description: 'Open GitHub Issues for triaged bugs with full AI context.',
  },
  {
    name: 'Zapier',
    mark: 'zapier',
    pkg: '@mushi-mushi/plugin-zapier',
    direction: 'outbound',
    category: 'Project Management',
    description: 'Connect Mushi to 6 000+ apps via Zapier webhooks.',
  },
  {
    name: 'Plugin SDK',
    pkg: '@mushi-mushi/plugin-sdk',
    direction: 'sdk',
    category: 'APM & Telemetry',
    description: 'Build custom inbound or outbound integrations with the Mushi plugin SDK.',
  },
]

export const CATEGORIES: Category[] = [
  'All',
  'Error Monitoring',
  'APM & Telemetry',
  'Analytics',
  'Chat & Notifications',
  'Project Management',
  'Mobile',
]
