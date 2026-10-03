/**
 * SharedResourcesCard — what the team's apps share (Plan 019 Phase P2): an
 * auth project, a Supabase project, a domain, a Slack channel, a bundle id…
 * and which apps use each. Read from recipes, connectors and CSV imports.
 *
 * Data: GET /v1/admin/orgs/:orgId/portfolio/resources
 */

import { ErrorAlert, Loading, Section } from '../ui'
import { usePageData } from '../../lib/usePageData'

interface ResourcesResponse {
  resources: Array<{ id: string; kind: string; externalId: string; uses: Array<{ projectId: string; role: string; source: string }> }>
}

const KIND_LABEL: Record<string, string> = {
  auth_provider: 'Sign-in', supabase_project: 'Supabase project', stripe_account: 'Stripe account', domain: 'Domain',
  deep_link_domain: 'Deep link', bundle_id: 'Store app', push_channel: 'Push', slack_channel: 'Slack channel',
  posthog_project: 'PostHog', sentry_project: 'Sentry project', repo: 'Repo', legacy_system: 'Other system', revenuecat_project: 'RevenueCat', account: 'Account',
}

export function SharedResourcesCard({ orgId, names }: { orgId: string; names: Map<string, string> }) {
  const path = `/v1/admin/orgs/${orgId}/portfolio/resources`
  const { data, loading, error, reload } = usePageData<ResourcesResponse>(path)
  const shared = (data?.resources ?? []).filter((r) => new Set(r.uses.map((u) => u.projectId)).size >= 2)
  return (
    <Section title="Shared between apps">
      {error && <ErrorAlert message={error} endpoint={path} onRetry={reload} />}
      {loading && !data && <Loading text="Reading shared resources…" />}
      {data && (shared.length === 0 ? (
        <p className="text-sm text-fg-muted">No resource is used by two or more apps yet. Declare links in mushi.recipe.json or connect a source to see them.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {shared.map((r) => (
            <li key={r.id} className="flex flex-wrap gap-2">
              <span className="text-fg-muted">{KIND_LABEL[r.kind] ?? r.kind}</span>
              <code className="font-mono text-xs text-fg">{r.externalId}</code>
              <span className="text-fg-secondary">{[...new Set(r.uses.map((u) => names.get(u.projectId) ?? u.projectId.slice(0, 8)))].join(', ')}</span>
            </li>
          ))}
        </ul>
      ))}
    </Section>
  )
}
