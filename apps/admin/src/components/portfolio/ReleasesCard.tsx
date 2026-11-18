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
 * Sweep 2026-11-18: two or more apps in one stage share a group row ("In review · 3 apps");
 * an app whose stage was not checked shows hatched "—" for its counts, never 0.
 * Round 2 (2026-11-18): a column empty on every row is not drawn. The Stage column only holds
 * a pill for an app alone in its stage (the group rows carry the rest), so with every stage
 * grouped it is gone; Native changes at 0 on every checked app becomes one line instead.
 *
 * Data: GET /v1/admin/orgs/:orgId/releases
 */

import { ErrorAlert, Section } from '../ui'
import { TimedLoading } from './TimedLoading'
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

/** @internal Exported for ReleasesCard.test.tsx. */
export function sortReleaseRows(rows: readonly ReleaseRow[]): ReleaseRow[] {
  const rank = (r: ReleaseRow) => (STAGE[r.stage] ?? STAGE.unknown).rank
  return [...rows].sort((a, b) => rank(a) - rank(b) || b.otaPending + b.mergedNotBuilt - (a.otaPending + a.mergedNotBuilt) || a.name.localeCompare(b.name))
}

/**
 * Sorted rows cut into runs of one stage, for the group rows.
 * @internal Exported for ReleasesCard.test.tsx.
 */
export function groupReleaseRows(rows: readonly ReleaseRow[]): Array<{ stage: string; rows: ReleaseRow[] }> {
  const out: Array<{ stage: string; rows: ReleaseRow[] }> = []
  for (const r of sortReleaseRows(rows)) {
    const stage = STAGE[r.stage] ? r.stage : 'unknown'
    const last = out[out.length - 1]
    if (last && last.stage === stage) last.rows.push(r)
    else out.push({ stage, rows: [r] })
  }
  return out
}

function Count({ n, unknown }: { n: number; unknown: boolean }) {
  // Not checked is not zero: hatched "—", like every other cell with no data.
  if (unknown) return <span className="text-fg-muted" title="Not checked">—</span>
  return <span className={`tabular-nums ${n > 0 ? 'font-semibold text-fg' : 'text-fg-faint'}`}>{n}</span>
}

const TH = 'px-2 py-1 align-bottom text-2xs font-semibold text-fg-secondary'

/**
 * Which optional columns carry anything (round 2: "Stage" was empty on every row and "Native
 * changes" 0 on every row). @internal Exported for ReleasesCard.test.tsx.
 */
export function releaseColumns(rows: readonly ReleaseRow[]): { stage: boolean; native: boolean } {
  const groups = groupReleaseRows(rows)
  return {
    // A pill sits in the Stage cell only for an app alone in its stage.
    stage: groups.some((g) => g.rows.length === 1),
    native: rows.some((r) => (STAGE[r.stage] ? r.stage : 'unknown') !== 'unknown' && r.mergedNotBuilt > 0),
  }
}

export function ReleasesCard({ orgId }: { orgId: string }) {
  const path = `/v1/admin/orgs/${orgId}/releases`
  const { data, loading, error, reload } = usePageData<ReleasesResponse>(path)
  return (
    <Section title="Releases">
      {error && <ErrorAlert message={error} endpoint={path} onRetry={reload} />}
      <TimedLoading waiting={loading && !data && !error} text="Reading releases…" what="Releases" onRetry={reload} testId="portfolio-releases-not-checked" />
      {data && data.rows.length === 0 && <p className="text-sm text-fg-muted">No apps yet.</p>}
      {data && data.rows.length > 0 && (() => {
        const cols = releaseColumns(data.rows)
        const span = 3 + (cols.stage ? 1 : 0) + (cols.native ? 1 : 0)
        return (
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
                  {cols.stage && <th scope="col" className={`${TH} text-left`}>Stage</th>}
                  <th scope="col" className={`${TH} text-left`}>Live</th>
                  {cols.native && (
                    <th scope="col" className={`${TH} text-right`} title="Native changes merged since the live build: they need a store build">Native changes</th>
                  )}
                  <th scope="col" className={`${TH} text-right`} title="JS-only changes that can ship as an over-the-air update">OTA changes</th>
                </tr>
              </thead>
              <tbody>
                {groupReleaseRows(data.rows).flatMap(({ stage: id, rows }) => {
                  const stage = STAGE[id] ?? STAGE.unknown
                  // Two or more apps in one stage share a group row instead of repeating the pill.
                  const grouped = rows.length > 1
                  const unknown = id === 'unknown'
                  const head = grouped ? (
                    <tr key={`stage:${id}`} className="border-b border-edge-subtle bg-surface-overlay/40" data-testid={`releases-stage-${id}`}>
                      <th scope="colgroup" colSpan={span} className="px-2 py-1 text-left font-normal">
                        <span className="flex items-center gap-2">
                          <StatusPill status={stage.status} label={stage.label} />
                          <span className="whitespace-nowrap text-2xs font-semibold text-fg-secondary">{rows.length} apps</span>
                        </span>
                      </th>
                    </tr>
                  ) : null
                  const body = rows.map((r) => (
                    <tr key={r.projectId} className="border-b border-edge-subtle hover:bg-surface-overlay/60" data-stage={r.stage}>
                      <td className={`max-w-48 truncate px-2 py-1 font-semibold text-fg ${grouped ? 'pl-5' : ''}`}>{r.name}</td>
                      {cols.stage && <td className="px-2 py-1">{!grouped && <StatusPill status={stage.status} label={stage.label} />}</td>}
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
                      {cols.native && (
                        <td className={`px-2 py-1 text-right ${unknown ? 'ci-nodata' : ''}`}>
                          <Count n={r.mergedNotBuilt} unknown={unknown} />
                        </td>
                      )}
                      <td className={`px-2 py-1 text-right ${unknown ? 'ci-nodata' : ''}`}>
                        <Count n={r.otaPending} unknown={unknown} />
                      </td>
                    </tr>
                  ))
                  return head ? [head, ...body] : body
                })}
              </tbody>
            </table>
          </div>
          {!cols.native && data.rows.some((r) => STAGE[r.stage] && r.stage !== 'unknown') && (
            <p className="text-2xs text-fg-secondary" data-testid="releases-no-native">
              No native changes waiting: nothing needs a store build.
            </p>
          )}
          {data.note && <p className="text-2xs text-fg-faint">{data.note}</p>}
        </div>
        )
      })()}
    </Section>
  )
}
