/**
 * FILE: apps/admin/src/components/ux-runs/UxSurfaceDetail.tsx
 * PURPOSE: One screen of a synced `mushi ux` run: before vs any attempt on a
 *          slider (mobile or desktop) with a changed-pixels overlay, every
 *          attempt as a thumbnail card, the measured problems, the advisory
 *          review, and "File as bug" (a normal report, source ux_loop).
 */

import { useState } from 'react'
import { Badge, Btn, Callout, Card, SegmentedControl } from '../ui'
import { IconCheck, IconFlag } from '../icons'
import { apiFetchMutate } from '../../lib/supabase'
import { foldSteps, problemLines, UX_PLAN_STEP_META, UX_STATUS_META, type UxIterationRow, type UxSurfaceRow, type UxViewport } from '../../lib/uxRuns'

const OUTCOME: Record<UxIterationRow['outcome'], { label: string; tone: 'okSubtle' | 'dangerSubtle' | 'neutral' }> = {
  accepted: { label: 'Kept', tone: 'okSubtle' },
  rejected: { label: 'Rolled back', tone: 'dangerSubtle' },
  agent_failed: { label: 'Agent failed', tone: 'dangerSubtle' },
  capture_failed: { label: 'Screen broke', tone: 'dangerSubtle' },
  no_change: { label: 'No change', tone: 'neutral' },
}

type CompareView = 'side' | 'slider'
const COMPARE_VIEWS: Array<{ id: CompareView; label: string }> = [
  { id: 'side', label: 'Side by side' },
  { id: 'slider', label: 'Slider' },
]

const VIEWPORTS: Array<{ id: UxViewport; label: string }> = [
  { id: 'mobile', label: 'Mobile' },
  { id: 'desktop', label: 'Desktop' },
]

interface Props {
  projectId: string
  runId: string
  surface: UxSurfaceRow
  iterations: UxIterationRow[]
  /** The attempt the agent is on, when it is working on this screen now. */
  workingAttempt?: number | null
  onFiled: () => void
}

/** A plan step's `file` and `Component` names as code; an unclosed backtick stays as text. */
function withCode(text: string): Array<string | React.JSX.Element> {
  return text.split(/(`[^`]+`)/).map((part, i) =>
    part.length > 2 && part.startsWith('`') && part.endsWith('`') ? (
      <code key={i} className="rounded bg-surface-overlay px-1 font-mono text-2xs text-fg [overflow-wrap:anywhere]">{part.slice(1, -1)}</code>
    ) : (
      part
    ),
  )
}

/** Signed URL for a slot, falling back to the legacy desktop columns. */
function surfaceShot(s: UxSurfaceRow, slot: 'before' | 'after' | 'diff', vp: UxViewport): string | null {
  const url = s.thumb_urls?.[`${slot}-${vp}`]
  if (url) return url
  if (vp !== 'desktop') return null
  return slot === 'before' ? s.thumb_before_url : slot === 'after' ? s.thumb_after_url : s.thumb_diff_url
}

export function UxSurfaceDetail({ projectId, runId, surface, iterations, workingAttempt, onFiled }: Props) {
  const hasMobile = Boolean(surface.thumb_urls?.['before-mobile'])
  const [vp, setVp] = useState<UxViewport>(hasMobile ? 'mobile' : 'desktop')
  const [picked, setPicked] = useState<number | null>(null)
  const [cut, setCut] = useState(50)
  // Side by side first: a half-split slider read as a cut-off screenshot (owner, 2026-10-07).
  const [view, setView] = useState<CompareView>('side')
  const [showDiff, setShowDiff] = useState(false)
  const [filing, setFiling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const meta = UX_STATUS_META[surface.status]

  // Attempts with a screenshot at this width; default to the kept one, else the latest.
  const shotOf = (it: UxIterationRow, slot: 'after' | 'diff') => it.thumb_urls?.[`${slot}-${vp}`] ?? null
  const withShots = iterations.filter((it) => shotOf(it, 'after'))
  const kept = [...withShots].reverse().find((it) => it.outcome === 'accepted')
  const chosen = withShots.find((it) => it.n === picked) ?? kept ?? withShots[withShots.length - 1] ?? null
  const before = surfaceShot(surface, 'before', vp)
  const after = chosen ? shotOf(chosen, 'after') : surfaceShot(surface, 'after', vp)
  const diff = chosen ? shotOf(chosen, 'diff') : surfaceShot(surface, 'diff', vp)
  // Small-steps runs name an attempt by its plan step, so "Step 4" matches the checklist.
  const plan = surface.plan?.length ? surface.plan : null
  const attemptName = (it: UxIterationRow) => {
    const k = it.step && plan ? plan.findIndex((p) => p.text === it.step) : -1
    return k >= 0 ? `Step ${k + 1}` : `Attempt ${it.n}`
  }
  const afterLabel = chosen ? attemptName(chosen) : 'After'
  const afterScore = chosen?.penalty_after ?? surface.penalty_after

  const current = surface.probe_after ?? surface.probe_before
  const problems = problemLines(current)
  // Filing a bug is for a screen that still has something wrong.
  const worthFiling = Boolean(surface.report_id) || problems.length > 0 || ['reverted', 'regressed', 'blocked'].includes(surface.status)

  async function fileAsBug() {
    setFiling(true)
    setError(null)
    const res = await apiFetchMutate<{ report_id: string }>(
      `/v1/admin/projects/${projectId}/ux-runs/${runId}/surfaces/${surface.surface_key}/report`,
      { method: 'POST', body: '{}' },
    )
    setFiling(false)
    if (!res.ok) setError(res.error?.message ?? 'Could not file the report.')
    else onFiled()
  }

  return (
    <Card className="flex min-w-0 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg">{surface.label}</h2>
          <p className="font-mono text-2xs text-fg-muted">
            {surface.path} · {surface.kind}
          </p>
        </div>
        <Badge tone={meta.tone} title={meta.hint}>{meta.label}</Badge>
      </div>
      {surface.note && <p className="text-xs text-fg-secondary">{surface.note}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl value={vp} onChange={setVp} options={VIEWPORTS} ariaLabel="Screen width" size="sm" />
        {after && <SegmentedControl value={view} onChange={setView} options={COMPARE_VIEWS} ariaLabel="How to compare" size="sm" />}
        {after && diff && view === 'slider' && (
          <label className="inline-flex items-center gap-1.5 text-2xs text-fg-secondary">
            <input type="checkbox" checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)} />
            Show changed pixels
          </label>
        )}
      </div>

      {/* Phone screenshots are narrow: on wide screens the plan sits beside them. The attempts
          stay full width below, where their badges and notes have room. */}
      <div className={vp === 'mobile' && plan ? 'flex flex-col gap-4 xl:flex-row xl:items-start' : 'flex flex-col gap-4'}>
        <div className={vp === 'mobile' && plan ? 'min-w-0 xl:w-96 xl:shrink-0' : 'min-w-0'}>
      {before && after && view === 'side' ? (
        <div className={`grid grid-cols-2 gap-2 ${vp === 'mobile' ? 'max-w-xl' : ''}`}>
          <figure className="m-0 min-w-0">
            <figcaption className="mb-1 text-2xs text-fg-muted">Before · problem score {surface.penalty_before ?? '—'}</figcaption>
            <img src={before} alt="Before" className="block h-auto w-full rounded-md border border-edge-subtle bg-surface" />
          </figure>
          <figure className="m-0 min-w-0">
            <figcaption className="mb-1 text-2xs text-fg-muted">{afterLabel} · problem score {afterScore ?? '—'}</figcaption>
            <img src={after} alt={afterLabel} className="block h-auto w-full rounded-md border border-edge-subtle bg-surface" />
          </figure>
        </div>
      ) : before ? (
        <div className="flex flex-col gap-2">
          <div className={`relative overflow-hidden rounded-md border border-edge-subtle bg-surface ${vp === 'mobile' ? 'max-w-sm' : ''}`}>
            <img src={before} alt="Before" className="block h-auto w-full" />
            {after && (
              <img src={after} alt={afterLabel} className="absolute inset-0 block h-auto w-full" style={{ clipPath: `inset(0 0 0 ${cut}%)` }} />
            )}
            {showDiff && after && diff && (
              <img src={diff} alt="Changed pixels" className="absolute inset-0 block h-auto w-full opacity-80 mix-blend-multiply" />
            )}
          </div>
          {after && (
            <>
              <input
                type="range"
                min={0}
                max={100}
                value={cut}
                onChange={(e) => setCut(Number(e.target.value))}
                aria-label={`Before and ${afterLabel.toLowerCase()} split`}
                className={`w-full ${vp === 'mobile' ? 'max-w-sm' : ''}`}
              />
              <div className={`flex flex-wrap items-center justify-between gap-2 text-2xs text-fg-muted ${vp === 'mobile' ? 'max-w-sm' : ''}`}>
                <span>◀ Before · problem score {surface.penalty_before ?? '—'}</span>
                <span>{afterLabel} · problem score {afterScore ?? '—'} ▶</span>
              </div>
              <p className={`text-2xs text-fg-muted ${vp === 'mobile' ? 'max-w-sm' : ''}`}>
                Drag the handle: left of it is before, right of it is after. One screenshot split in two, not cut off.
              </p>
            </>
          )}
        </div>
      ) : (
        <p className="text-xs text-fg-muted">
          {vp === 'mobile' && surfaceShot(surface, 'before', 'desktop')
            ? 'No mobile screenshot for this run. Switch to desktop.'
            : "No screenshots synced for this screen yet (they are kept for the project's retention window)."}
        </p>
      )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {plan && (
            <section aria-label="Plan">
              <h3 className="mb-2 text-xs font-semibold text-fg">
                Plan: {plan.filter((p) => p.status === 'done').length} of {plan.length} steps kept
              </h3>
              <ol className="flex flex-col gap-1.5">
                {plan.map((p, i) => {
                  const m = UX_PLAN_STEP_META[p.status]
                  const tone = p.status === 'done' ? 'text-ok' : p.status === 'failed' ? 'text-danger' : 'text-fg-muted'
                  return (
                    <li key={`${i}-${p.text}`} className="flex items-start gap-2 rounded-md border border-edge-subtle px-2 py-1.5 text-xs">
                      <span className={`w-4 shrink-0 text-center font-semibold ${tone}`} aria-hidden>{m.mark}</span>
                      <span className="min-w-0 text-fg-secondary">
                        <span className="font-medium text-fg">Step {i + 1}.</span> {withCode(p.text)}{' '}
                        <span className="text-fg-muted">({m.label})</span>
                      </span>
                    </li>
                  )
                })}
              </ol>
            </section>
          )}
        </div>
      </div>

      {(iterations.length > 0 || workingAttempt) && (
        <section aria-label="Attempts">
          <h3 className="mb-2 text-xs font-semibold text-fg">Attempts</h3>
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {iterations.map((it) => {
              const thumb = shotOf(it, 'after')
              const active = chosen?.n === it.n
              const o = OUTCOME[it.outcome]
              const px = it.pixel_diff?.[vp]
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => thumb && setPicked(it.n)}
                    disabled={!thumb}
                    aria-pressed={active}
                    className={`flex h-full w-full flex-col overflow-hidden rounded-md border text-left text-xs ${active ? 'border-brand ring-1 ring-brand/50' : 'border-edge-subtle hover:bg-surface-raised'} disabled:cursor-default`}
                  >
                    {thumb ? (
                      <img src={thumb} alt={attemptName(it)} loading="lazy" className="h-28 w-full bg-surface-overlay object-cover object-top" />
                    ) : (
                      <span className="grid h-28 w-full place-items-center bg-surface-overlay text-2xs text-fg-muted">No screenshot</span>
                    )}
                    <span className="flex flex-col gap-0.5 p-2">
                      <span className="flex items-center justify-between gap-1">
                        <span className="font-medium text-fg">{attemptName(it)}</span>
                        <Badge tone={o.tone}>{o.label}</Badge>
                      </span>
                      {it.reason && <span className="line-clamp-2 text-fg-secondary">{it.reason}</span>}
                      <span className="font-mono text-2xs text-fg-muted">
                        {it.duration_ms != null ? `${Math.round(it.duration_ms / 1000)}s` : ''}
                        {px != null ? ` · ${(px * 100).toFixed(1)}% px` : ''}
                        {it.commit_sha ? ` · ${it.commit_sha.slice(0, 8)}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
            {workingAttempt ? (
              <li aria-busy="true" className="grid min-h-28 place-items-center rounded-md border border-dashed border-info/50 bg-info-muted p-2 text-center text-2xs text-info-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-current motion-safe:animate-pulse" aria-hidden />
                  Attempt {workingAttempt} in progress
                </span>
              </li>
            ) : null}
          </ol>
          {iterations[0] && (
            <p className="mt-1 font-mono text-2xs text-fg-muted">
              {iterations[0].agent}
              {iterations[0].model ? ` · ${iterations[0].model}` : ''}
            </p>
          )}
          {iterations.map((it) =>
            it.steps ? (
              <details key={it.id} className="mt-1 text-2xs">
                <summary className="cursor-pointer text-fg-muted hover:text-fg">What the agent did in {attemptName(it).toLowerCase()}</summary>
                <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-overlay p-2 font-mono text-fg-secondary">{foldSteps(it.steps).join('\n')}</pre>
              </details>
            ) : null,
          )}
        </section>
      )}

      <section aria-label="Measured problems">
        <h3 className="mb-1 text-xs font-semibold text-fg">Still measured on this screen</h3>
        {problems.length ? (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-fg-secondary">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        ) : (
          <p className="inline-flex items-center gap-1 text-xs text-ok-foreground"><IconCheck className="h-3.5 w-3.5" /> No accessibility, layout or console problems measured.</p>
        )}
      </section>

      {(surface.judge ?? []).map((j) => (
        <section key={j.viewport} aria-label={`Review, ${j.viewport}`} className="rounded-md border border-edge-subtle p-2 text-xs">
          <p className="font-medium text-fg">
            Review ({j.viewport}, {j.model}) <span className="font-normal text-fg-muted">— advisory, never keeps or reverts anything</span>
          </p>
          <p className="mt-0.5 text-fg-secondary">
            {j.error
              ? j.error
              : `Prefers ${j.preferred === 'tie' ? 'neither' : j.preferred === 'after' ? 'the new version' : 'the original'} (${j.confidence} confidence). ${j.summary}`}
          </p>
          {(j.worse ?? []).length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-fg-secondary">
              {(j.worse ?? []).map((w) => <li key={w.what}>{w.what}: {w.why}</li>)}
            </ul>
          )}
        </section>
      ))}

      {error && <Callout tone="danger"><span role="alert">{error}</span></Callout>}
      {worthFiling && (
      <div className="flex flex-wrap items-center gap-2">
        {surface.report_id ? (
          <Btn to={`/reports/${surface.report_id}`} size="sm" variant="ghost">Open the filed report</Btn>
        ) : (
          <Btn size="sm" variant="ghost" onClick={fileAsBug} loading={filing} disabled={filing}>
            <IconFlag className="h-3.5 w-3.5" aria-hidden />
            File as bug
          </Btn>
        )}
        <span className="text-2xs text-fg-muted">Adds it to the bug queue with the measurements above. No AI call.</span>
      </div>
      )}
    </Card>
  )
}
