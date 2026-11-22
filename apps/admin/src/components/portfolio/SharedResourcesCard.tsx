/**
 * SharedResourcesCard — what the team's apps share (Plan 019 Phase P2): an
 * auth project, a Supabase project, a domain, a Slack channel, a bundle id…
 * and which apps use each. Read from recipes, connectors and CSV imports.
 * Owners and admins can import a CSV here (ResourceCsvImport).
 *
 * Data: GET /v1/admin/orgs/:orgId/portfolio/resources
 *       POST /v1/ingest/recipe/csv (ResourceCsvImport)
 */

import { ErrorAlert, Section } from '../ui'
import { TimedLoading } from './TimedLoading'
import { usePageData } from '../../lib/usePageData'
import { ResourceCsvImport } from './ResourceCsvImport'
import { AppIconChips, type IconFor } from './AppIconChips'

interface ResourcesResponse {
  /** Absent on an older api; then the import stays hidden. */
  canImport?: boolean
  resources: Array<{ id: string; kind: string; externalId: string; uses: Array<{ projectId: string; role: string; source: string }> }>
}

const KIND_LABEL: Record<string, string> = {
  auth_provider: 'Sign-in', supabase_project: 'Supabase project', stripe_account: 'Stripe account', domain: 'Domain',
  deep_link_domain: 'Deep link', bundle_id: 'Store app', push_channel: 'Push', slack_channel: 'Slack channel',
  posthog_project: 'PostHog', sentry_project: 'Sentry project', repo: 'Repo', legacy_system: 'Other system', revenuecat_project: 'RevenueCat', account: 'Account',
}

export function SharedResourcesCard({ orgId, iconFor }: { orgId: string; iconFor: IconFor }) {
  const path = `/v1/admin/orgs/${orgId}/portfolio/resources`
  const { data, loading, error, reload } = usePageData<ResourcesResponse>(path)
  const shared = (data?.resources ?? []).filter((r) => new Set(r.uses.map((u) => u.projectId)).size >= 2)
  return (
    <Section title="Shared between apps">
      {error && <ErrorAlert message={error} endpoint={path} onRetry={reload} />}
      <TimedLoading waiting={loading && !data && !error} text="Reading shared resources…" what="Shared resources" onRetry={reload} testId="portfolio-shared-not-checked" />
      {data && (shared.length === 0 ? (
        <p className="text-sm text-fg-muted">No resource is used by two or more apps yet. {data.canImport ? 'Declare links in mushi.recipe.json, connect a source, or import a CSV below to see them.' : 'Declare links in mushi.recipe.json or connect a source to see them.'}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-edge-subtle text-xs">
          {shared.map((r) => {
            const apps = [...new Set(r.uses.map((u) => u.projectId))]
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-1">
                <span className="font-semibold text-fg-secondary">{KIND_LABEL[r.kind] ?? r.kind}</span>
                <code className="font-mono text-fg">{r.externalId}</code>
                <span className="font-mono text-2xs font-bold text-fg-secondary tabular-nums" title={`${apps.length} apps`}>
                  {apps.length}
                  <span className="sr-only"> apps</span>
                </span>
                <AppIconChips projectIds={apps} iconFor={iconFor} />
              </li>
            )
          })}
        </ul>
      ))}
      {data?.canImport && (
        <div className="mt-3">
          <ResourceCsvImport orgId={orgId} onImported={reload} />
        </div>
      )}
    </Section>
  )
}
