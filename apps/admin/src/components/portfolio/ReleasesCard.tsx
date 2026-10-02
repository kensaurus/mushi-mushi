/**
 * ReleasesCard — the release calendar across apps (Plan 020 §5): for each app,
 * native changes merged since the last live deploy, JS-only changes that can
 * ship as OTA, store review state and rollout %. Ends with a batch suggestion
 * that keeps CI minutes down. Read-only; your own CI builds and submits.
 *
 * Data: GET /v1/admin/orgs/:orgId/releases
 */

import { Badge, ErrorAlert, Loading, Section, type BadgeTone } from '../ui'
import { usePageData } from '../../lib/usePageData'

interface ReleasesResponse {
  rows: Array<{
    projectId: string
    name: string
    mergedNotBuilt: number
    builtNotSubmitted: number | null
    inReview: boolean | null
    live: { version: string; rolloutPct: number | null } | null
    otaPending: number
    stage: string
  }>
  batchSuggestion: { note: string } | null
  note?: string
}

const STAGE: Record<string, { label: string; tone: BadgeTone }> = {
  idle: { label: 'Nothing waiting', tone: 'okSubtle' },
  ota_ready: { label: 'OTA ready', tone: 'infoSubtle' },
  waiting_for_build: { label: 'Needs a store build', tone: 'warnSubtle' },
  ready_to_submit: { label: 'Ready to submit', tone: 'infoSubtle' },
  in_review: { label: 'In review', tone: 'infoSubtle' },
  rolling_out: { label: 'Rolling out', tone: 'infoSubtle' },
  unknown: { label: 'Not checked', tone: 'neutral' },
}

export function ReleasesCard({ orgId }: { orgId: string }) {
  const path = `/v1/admin/orgs/${orgId}/releases`
  const { data, loading, error, reload } = usePageData<ReleasesResponse>(path)
  return (
    <Section title="Releases">
      {error && <ErrorAlert message={error} endpoint={path} onRetry={reload} />}
      {loading && !data && <Loading text="Reading releases…" />}
      {data && data.rows.length === 0 && <p className="text-sm text-fg-muted">No apps yet.</p>}
      {data && data.rows.length > 0 && (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col divide-y divide-edge-subtle">
            {data.rows.map((r) => {
              const stage = STAGE[r.stage] ?? STAGE.unknown
              return (
                <li key={r.projectId} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm font-medium text-fg">{r.name}</span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                    <span>Live: {r.live ? `${r.live.version}${r.live.rolloutPct !== null ? ` at ${r.live.rolloutPct}%` : ''}` : 'not checked'}</span>
                    <span>Native changes: {r.mergedNotBuilt}</span>
                    <span>OTA: {r.otaPending}</span>
                    <Badge tone={stage.tone}>{stage.label}</Badge>
                  </span>
                </li>
              )
            })}
          </ul>
          {data.batchSuggestion && <p className="text-sm text-fg">{data.batchSuggestion.note}</p>}
          {data.note && <p className="text-2xs text-fg-faint">{data.note}</p>}
        </div>
      )}
    </Section>
  )
}
