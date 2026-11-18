/**
 * ReleasesCard — the release calendar across apps (Plan 020 §5): for each app,
 * native changes merged since the last live deploy, JS-only changes that can
 * ship as OTA, store review state and rollout %. Ends with a batch suggestion
 * that keeps CI minutes down. Read-only; your own CI builds and submits.
 *
 * 2026-11-18 (owner: "badly done uiux… not enhanced yet"): one table row per app
 * instead of a "Live: … Native changes: 0 OTA: 36" line. The stage is a status
 * pill (shape + colour, in review pulses), the rollout is a bar, a zero count is
 * faint so the waiting work stands out, and apps with work waiting sort first.
 *
 * Data: GET /v1/admin/orgs/:orgId/releases
 */

import { ErrorAlert, Loading, Section } from '../ui'
import { usePageData } from '../../lib/usePageData'
import { StatusPill, type RunStatus } from '../signal/StatusMark'
import { StatusGlyph } from '../signal/StatusGlyph'
import { BarCell } from '../signal/BarCell'

interface ReleaseRow {
  projectId: string
  name: string
  mergedNotBuilt: number
  builtNotSubmitted: number | null
  inReview: boolean | null
  live: { version: string; rolloutPct: number | null } | null
  otaPending: number
  stage: string
}

interface ReleasesResponse {
  rows: ReleaseRow[]
  batchSuggestion: { note: string } | null
  note?: string
}

/** Each stage as a run state, and its order: what needs a step from you first, "not checked" last. */
const STAGE: Record<string, { label: string; status: RunStatus; rank: number }> = {
  waiting_for_build: { label: 'Needs a store build', status: 'slow', rank: 0 },
  ready_to_submit: { label: 'Ready to submit', status: 'waiting', rank: 1 },
  ota_ready: { label: 'OTA ready', status: 'waiting', rank: 2 },
  in_review: { label: 'In review', status: 'running', rank: 3 },
  rolling_out: { label: 'Rolling out', status: 'running', rank: 4 },
  idle: { label: 'Nothing waiting', status: 'passed', rank: 5 },
  unknown: { label: 'Not checked', status: 'idle', rank: 6 },
}

export function sortReleaseRows(rows: readonly ReleaseRow[]): ReleaseRow[] {
  const rank = (r: ReleaseRow) => (STAGE[r.stage] ?? STAGE.unknown).rank
  return [...rows].sort((a, b) => rank(a) - rank(b) || b.otaPending + b.mergedNotBuilt - (a.otaPending + a.mergedNotBuilt) || a.name.localeCompare(b.name))
}

function Count({ n }: { n: number }) {
  return <span className={`tabular-nums ${n > 0 ? 'font-semibold text-fg' : 'text-fg-faint'}`}>{n}</span>
}

const TH = 'px-2 py-1 align-bottom text-2xs font-semibold text-fg-secondary'

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
          {data.batchSuggestion && (
            <p className="flex items-start gap-1.5 text-sm font-medium text-fg" data-testid="releases-batch">
              <StatusGlyph tone="info" className="mt-1" />
              {data.batchSuggestion.note}
            </p>
          )}
          <div className="relative min-w-0 overflow-x-auto">
            <table className="w-full min-w-120 text-xs" data-testid="releases-table">
              <caption className="sr-only">Release state per app, apps with work waiting first</caption>
              <thead>
                <tr className="border-b border-edge">
                  <th scope="col" className={`${TH} text-left`}>App</th>
                  <th scope="col" className={`${TH} text-left`}>Stage</th>
                  <th scope="col" className={`${TH} text-left`}>Live</th>
                  <th scope="col" className={`${TH} text-right`} title="Native changes merged since the live build: they need a store build">Native</th>
                  <th scope="col" className={`${TH} text-right`} title="JS-only changes that can ship as an over-the-air update">OTA</th>
                </tr>
              </thead>
              <tbody>
                {sortReleaseRows(data.rows).map((r) => {
                  const stage = STAGE[r.stage] ?? STAGE.unknown
                  return (
                    <tr key={r.projectId} className="border-b border-edge-subtle hover:bg-surface-overlay/60" data-stage={r.stage}>
                      <td className="max-w-48 truncate px-2 py-1 font-semibold text-fg">{r.name}</td>
                      <td className="px-2 py-1">
                        <StatusPill status={stage.status} label={stage.label} />
                      </td>
                      <td className="px-2 py-1">
                        {r.live ? (
                          <span className="flex items-center gap-2">
                            <span className="font-mono text-fg-secondary">{r.live.version}</span>
                            {r.live.rolloutPct !== null && (
                              <BarCell value={r.live.rolloutPct} max={100} tone={r.live.rolloutPct >= 100 ? 'ok' : 'info'} text={`${r.live.rolloutPct}%`} widthClass="w-12" />
                            )}
                          </span>
                        ) : (
                          <span className="text-fg-faint">not checked</span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <Count n={r.mergedNotBuilt} />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <Count n={r.otaPending} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {data.note && <p className="text-2xs text-fg-faint">{data.note}</p>}
        </div>
      )}
    </Section>
  )
}
