/**
 * FILE: apps/admin/src/components/ux-runs/UxScorecardView.tsx
 * PURPOSE: The UX scorecard on /ux-runs?view=scorecard (ADR 0066): every page
 *          of the app scored 1–10 on a written rubric, worst first, with its
 *          trend across runs; the root causes that span pages; and the
 *          reports they were filed as. `mushi-ux scorecard --sync` fills it.
 *
 * Data: GET /v1/admin/projects/:pid/ux-scorecard[?run=<id>]
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, EmptyState, Loading, Sparkline, StatCard } from '../ui'
import { formatRelative } from '../ui/metrics'
import { PageLoadError } from '../PageLoadError'
import { apiFetchMutate } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import {
  crossCuttingCauses,
  deltaLabel,
  reportForCause,
  runMean,
  scoreTone,
  UX_DIMENSION_LABEL,
  UX_DIMENSIONS,
  type UxScorecardData,
  type UxScorecardRow,
} from '../../lib/uxScorecard'

const SEVERITY_TONE = { high: 'dangerSubtle', medium: 'warnSubtle', low: 'infoSubtle' } as const
/** Viewports offered for the next run: desktop first (console apps), a laptop, a phone. */
const VIEWPORTS = ['1440x900', '1280x800', '390x844'] as const

/** The viewport the next `mushi-ux scorecard` run of this app uses (project setting). */
function ViewportSetting({ projectId, value, onSaved }: { projectId: string; value: string; onSaved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const options = (VIEWPORTS as readonly string[]).includes(value) ? VIEWPORTS : [value, ...VIEWPORTS]
  return (
    <label className="flex items-center gap-1.5">
      <span>Next run at</span>
      <select
        className="rounded-sm border border-edge-subtle bg-surface px-1.5 py-0.5 text-xs text-fg"
        value={value}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true)
          setError(null)
          const res = await apiFetchMutate<{ viewport: string }>(`/v1/admin/projects/${projectId}/ux-scorecard`, { method: 'PATCH', body: JSON.stringify({ viewport: e.target.value }) })
          setBusy(false)
          if (res.ok) onSaved()
          else setError(res.error?.message ?? 'Not saved.')
        }}
      >
        {options.map((v) => (
          <option key={v} value={v}>
            {v === '390x844' ? `${v} (phone)` : v}
          </option>
        ))}
      </select>
      {error && <span className="text-danger">{error}</span>}
    </label>
  )
}

export function UxScorecardView({ projectId, runId, onPickRun }: { projectId: string; runId: string | null; onPickRun: (id: string) => void }) {
  const path = `/v1/admin/projects/${projectId}/ux-scorecard${runId ? `?run=${encodeURIComponent(runId)}` : ''}`
  const q = usePageData<UxScorecardData>(path)
  const [open, setOpen] = useState<string | null>(null)

  if (q.error) return <PageLoadError error={q.error} resource="the UX scorecard" endpoint={path} onRetry={q.reload} />
  if (q.loading && !q.data) return <Loading text="Loading the scorecard…" />
  const d = q.data
  if (!d?.run) {
    return (
      <EmptyState
        title="No scorecard yet"
        description={`Score every page of this app on your machine, with your signed-in browser profile: mushi-ux scorecard --url <your app> --profile-dir <cached profile> --sync. Pages are scored at ${d?.viewport ?? '1440x900'}; add --file to file the top root causes as bugs.`}
      />
    )
  }
  const mean = runMean(d)
  const cross = crossCuttingCauses(d.causes)
  const worst = d.rows.filter((r) => r.overall <= 4).length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-secondary">
        <label className="flex items-center gap-1.5">
          <span>Run</span>
          <select
            className="rounded-sm border border-edge-subtle bg-surface px-1.5 py-0.5 text-xs text-fg"
            value={d.run.local_run_id}
            onChange={(e) => onPickRun(e.target.value)}
          >
            {d.runs.map((r) => (
              <option key={r.local_run_id} value={r.local_run_id}>
                {formatRelative(r.started_at)} · {r.counts?.scored ?? 0} pages{r.counts?.mean != null ? ` · ${r.counts.mean}/10` : ''}
              </option>
            ))}
          </select>
        </label>
        <span>{d.run.detail ?? `viewport ${d.viewport}`}</span>
        <ViewportSetting projectId={projectId} value={d.viewport} onSaved={q.reload} />
        {d.run.model && <span>scored by {d.run.model}</span>}
        {d.run.status !== 'done' && <Badge tone={d.run.status === 'failed' ? 'dangerSubtle' : 'infoSubtle'}>{d.run.status === 'failed' ? 'Failed' : 'Running'}</Badge>}
      </div>
      {d.run.error && <p className="text-xs text-danger">{d.run.error}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Average score" value={mean == null ? '–' : `${mean}/10`} detail={`${d.rows.length} page${d.rows.length === 1 ? '' : 's'} scored`} />
        <StatCard label="Pages at 4 or below" value={worst} detail="misleading or blocked" />
        <StatCard label="Root causes" value={cross.length} detail="each spans pages; fix once" />
        <StatCard label="Filed as bugs" value={d.reports.filter((r) => cross.some((c) => c.patternKey === r.pattern_key)).length} detail="one report per cause" />
      </div>

      {cross.length > 0 && (
        <section aria-labelledby="ux-causes" className="flex flex-col gap-2">
          <h2 id="ux-causes" className="text-sm font-semibold text-fg">
            Root causes across pages
          </h2>
          <ol className="flex flex-col gap-2">
            {cross.map((c) => {
              const report = reportForCause(c, d.reports)
              return (
                <li key={c.patternKey} className="rounded-md border border-edge-subtle px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={SEVERITY_TONE[c.severity]}>{c.severity}</Badge>
                    <Badge tone="infoSubtle">{UX_DIMENSION_LABEL[c.dimension]}</Badge>
                    {c.kind === 'contradiction' && <Badge tone="warnSubtle">Two views disagree</Badge>}
                    <span className="font-medium text-fg">{c.title}</span>
                    {report ? (
                      <Link className="ml-auto text-brand underline underline-offset-2" to={`/reports/${report.id}`}>
                        Bug · {report.status}
                      </Link>
                    ) : null}
                  </div>
                  <p className="mt-1 text-fg-secondary">{c.problem}</p>
                  <p className="mt-1 text-fg">
                    <span className="font-medium">Fix:</span> {c.fix}
                  </p>
                  <p className="mt-1 text-2xs text-fg-muted">
                    {c.pages.length} page{c.pages.length === 1 ? '' : 's'}: {c.pages.map((p) => p.label).join(', ')}
                  </p>
                </li>
              )
            })}
          </ol>
        </section>
      )}

      <section aria-labelledby="ux-pages" className="flex flex-col gap-2">
        <h2 id="ux-pages" className="text-sm font-semibold text-fg">
          Pages, worst first
        </h2>
        <div className="overflow-x-auto rounded-md border border-edge-subtle">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface-raised text-2xs text-fg-muted">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-medium">Score</th>
                <th scope="col" className="px-3 py-1.5 font-medium">Page</th>
                <th scope="col" className="px-3 py-1.5 font-medium">Trend</th>
                <th scope="col" className="px-3 py-1.5 font-medium">Weakest</th>
                <th scope="col" className="px-3 py-1.5 font-medium">Top problem</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <PageRow key={r.key} row={r} open={open === r.key} onToggle={() => setOpen(open === r.key ? null : r.key)} />
              ))}
            </tbody>
          </table>
        </div>
        {(d.unscored?.length ?? 0) > 0 && (
          <p className="text-2xs text-fg-muted">
            Not scored: {d.unscored!.map((u) => `${u.label}${u.note ? ` (${u.note})` : ''}`).join('; ')}
          </p>
        )}
      </section>
    </div>
  )
}

function PageRow({ row, open, onToggle }: { row: UxScorecardRow; open: boolean; onToggle: () => void }) {
  const weakest = [...UX_DIMENSIONS].sort((a, b) => row.scores[a] - row.scores[b]).slice(0, 2)
  const delta = deltaLabel(row.delta)
  const top = row.issues[0]
  return (
    <>
      <tr className="border-t border-edge-subtle align-top">
        <td className="px-3 py-2">
          <Badge tone={scoreTone(row.overall)} aria-label={`Score ${row.overall} of 10`}>
            {row.overall}
          </Badge>
          {delta && <span className={`ml-1 text-2xs ${row.delta! > 0 ? 'text-ok' : 'text-danger'}`}>{delta}</span>}
        </td>
        <td className="px-3 py-2">
          <button type="button" onClick={onToggle} aria-expanded={open} className="text-left">
            <span className="block font-medium text-fg">{row.label}</span>
            <span className="block font-mono text-2xs text-fg-muted">{row.key}</span>
          </button>
        </td>
        <td className="px-3 py-2">
          {row.history.length ? <Sparkline values={[...row.history, row.overall]} ariaLabel={`Scores across runs: ${[...row.history, row.overall].join(', ')}`} width={64} height={16} /> : <span className="text-2xs text-fg-muted">first run</span>}
        </td>
        <td className="px-3 py-2 text-2xs text-fg-secondary">{weakest.map((dim) => `${UX_DIMENSION_LABEL[dim]} ${row.scores[dim]}`).join(' · ')}</td>
        <td className="px-3 py-2 text-fg-secondary">{top ? top.title : 'Nothing a user would trip on'}</td>
      </tr>
      {open && (
        <tr className="border-t border-edge-subtle bg-surface-raised/40">
          <td colSpan={5} className="px-3 py-2">
            <p className="text-2xs text-fg-muted">{UX_DIMENSIONS.map((dim) => `${UX_DIMENSION_LABEL[dim]} ${row.scores[dim]}`).join(' · ')}</p>
            <ol className="mt-2 flex flex-col gap-2">
              {row.issues.map((i, n) => (
                <li key={n} className="text-xs">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={SEVERITY_TONE[i.severity]}>{i.severity}</Badge>
                    <span className="font-medium text-fg">{i.title}</span>
                  </span>
                  <span className="mt-0.5 block text-fg-secondary">{i.problem}</span>
                  <span className="mt-0.5 block text-2xs text-fg-muted">
                    Evidence: “{i.evidence}”{i.evidenceSeen ? '' : ' (seen on the screenshot, not in the page text)'}
                  </span>
                  <span className="mt-0.5 block text-fg">
                    <span className="font-medium">Fix:</span> {i.fix}
                  </span>
                </li>
              ))}
            </ol>
          </td>
        </tr>
      )}
    </>
  )
}
