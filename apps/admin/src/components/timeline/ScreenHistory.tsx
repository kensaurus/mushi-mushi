/**
 * FILE: apps/admin/src/components/timeline/ScreenHistory.tsx
 * PURPOSE: One screen's history on the Timeline (ADR 0072): its pinned
 *          screenshots as a filmstrip (one per release), a before/after
 *          comparison of any two, its score across scorecard runs, and the
 *          changes the UX loop kept on it.
 *
 * Data: GET /v1/admin/projects/:pid/timeline/surfaces/:key
 *       PATCH …/timeline/baselines/:id { pinned } (keep one shot forever)
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, EmptyState, SegmentedControl, Skeleton, Sparkline } from '../ui'
import { formatRelative } from '../ui/metrics'
import { PageLoadError } from '../PageLoadError'
import { apiFetchMutate } from '../../lib/supabase'
import { usePageData } from '../../lib/usePageData'
import { scoreTone } from '../../lib/uxScorecard'
import { defaultPair, formatCost, type SurfaceHistory, type SurfaceHistoryFrame } from '../../lib/timeline'
import { CompareSlider } from './CompareSlider'
import { KeepForeverButton } from './TimelineControls'

type Viewport = 'desktop' | 'mobile'

export function ScreenHistory({ projectId, surfaceKey, canEdit, isOperator }: { projectId: string; surfaceKey: string; canEdit: boolean; isOperator: boolean }) {
  const path = `/v1/admin/projects/${projectId}/timeline/surfaces/${encodeURIComponent(surfaceKey)}`
  const q = usePageData<SurfaceHistory>(path)
  const frames = useMemo(() => q.data?.frames ?? [], [q.data])
  const hasMobile = frames.some((f) => f.viewport === 'mobile')
  const [viewport, setViewport] = useState<Viewport>('desktop')
  const at = useMemo(() => frames.filter((f) => f.viewport === viewport), [frames, viewport])
  const [leftId, setLeftId] = useState<string | null>(null)
  const [rightId, setRightId] = useState<string | null>(null)
  const [pinError, setPinError] = useState<string | null>(null)

  // A new screen or viewport opens on its oldest and newest shot; a reload keeps the pair picked.
  useEffect(() => {
    const pair = defaultPair(at, viewport)
    const has = (id: string | null) => id != null && at.some((f) => f.id === id)
    setLeftId((cur) => (has(cur) ? cur : (pair.before?.id ?? null)))
    setRightId((cur) => (has(cur) ? cur : (pair.after?.id ?? null)))
  }, [at, viewport])

  if (q.error) return <PageLoadError error={q.error} resource="this screen's history" endpoint={path} onRetry={q.reload} />
  if (q.loading && !q.data) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading the screen's history">
        <Skeleton className="aspect-video w-full rounded-md" />
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-24 rounded-sm" />
          ))}
        </div>
      </div>
    )
  }
  const h = q.data
  if (!h) return null
  const left = at.find((f) => f.id === leftId) ?? null
  const right = at.find((f) => f.id === rightId) ?? null
  const scores = h.scores.map((s) => s.score)
  const reused = h.scores.filter((s) => s.cached).length

  const pickRight = (f: SurfaceHistoryFrame) => {
    setRightId(f.id)
    const i = at.findIndex((x) => x.id === f.id)
    const li = at.findIndex((x) => x.id === leftId)
    if (li < 0 || li >= i) setLeftId(i > 0 ? at[i - 1].id : null)
  }

  const togglePinned = async (f: SurfaceHistoryFrame) => {
    setPinError(null)
    const res = await apiFetchMutate<{ pinned: boolean }>(`/v1/admin/projects/${projectId}/timeline/baselines/${f.id}`, { method: 'PATCH', body: JSON.stringify({ pinned: !f.pinned }) })
    if (res.ok) q.reload()
    else setPinError(res.error?.message ?? 'Not saved.')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-fg">{h.surface.label}</h3>
          {h.surface.path && <p className="truncate font-mono text-2xs text-fg-muted">{h.surface.path}</p>}
        </div>
        {hasMobile && (
          <SegmentedControl
            ariaLabel="Viewport"
            size="sm"
            value={viewport}
            options={[
              { id: 'desktop', label: 'Desktop' },
              { id: 'mobile', label: 'Phone' },
            ]}
            onChange={(v) => setViewport(v as Viewport)}
          />
        )}
      </div>

      {at.length === 0 ? (
        <EmptyState title="No pinned shots of this screen yet" description="Pin the current screens to a release, and this screen's shot shows up here. Each later release adds one." />
      ) : left?.url && right?.url ? (
        <CompareSlider screen={h.surface.label} mobile={viewport === 'mobile'} before={{ url: left.url, label: left.version }} after={{ url: right.url, label: right.version }} />
      ) : right?.url ? (
        <figure className="flex flex-col gap-1.5">
          <img src={right.url} alt={`${h.surface.label}, ${right.version}`} className={`w-full rounded-md border border-edge-subtle object-cover object-top ${viewport === 'mobile' ? 'mx-auto aspect-9/16 max-w-xs' : 'aspect-video'}`} />
          <figcaption className="text-2xs text-fg-muted">One release so far. The comparison opens once a second release is pinned.</figcaption>
        </figure>
      ) : null}

      {at.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2 text-2xs text-fg-secondary">
            <span className="font-semibold text-fg">Filmstrip</span>
            <span>Pick a shot to compare it with the one before it.</span>
            {at.length > 1 && (
              <label className="flex items-center gap-1">
                <span>Left</span>
                <select
                  className="rounded-sm border border-edge-subtle bg-surface px-1.5 py-0.5 text-xs text-fg"
                  value={leftId ?? ''}
                  onChange={(e) => setLeftId(e.target.value || null)}
                >
                  {at.map((f) => (
                    <option key={f.id} value={f.id} disabled={f.id === rightId}>
                      {f.version}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <ol aria-label={`${h.surface.label}, one shot per release`} className="flex gap-2 overflow-x-auto pb-1">
            {at.map((f) => {
              const isRight = f.id === rightId
              const isLeft = f.id === leftId
              return (
                <li key={f.id} className="flex w-28 shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => pickRight(f)}
                    aria-pressed={isRight}
                    aria-label={`${f.version}${f.score != null ? `, score ${f.score} of 10` : ''}${isLeft ? ', on the left' : ''}${isRight ? ', on the right' : ''}`}
                    className={`overflow-hidden rounded-sm border motion-safe:transition-transform motion-safe:duration-150 ${
                      isRight ? 'border-brand ring-2 ring-brand/40 motion-safe:-translate-y-0.5' : isLeft ? 'border-edge' : 'border-edge-subtle hover:border-edge'
                    }`}
                  >
                    {f.url ? (
                      <img src={f.url} alt="" loading="lazy" className={`w-full object-cover object-top ${viewport === 'mobile' ? 'aspect-9/16' : 'aspect-video'}`} />
                    ) : (
                      <span className="block aspect-video w-full bg-surface-raised" />
                    )}
                  </button>
                  <span className="flex items-center justify-between gap-1 text-2xs">
                    <span className="truncate font-medium text-fg">{f.version}</span>
                    {f.score != null && <Badge tone={scoreTone(f.score)}>{f.score}</Badge>}
                  </span>
                  <span className="text-2xs text-fg-muted">{formatRelative(f.created_at)}</span>
                  <KeepForeverButton pinned={f.pinned} canEdit={canEdit} onToggle={() => void togglePinned(f)} />
                </li>
              )
            })}
          </ol>
          {pinError && <p className="text-2xs text-danger">{pinError}</p>}
        </div>
      )}

      <div className="@container/history">
      <div className="grid gap-4 @xl/history:grid-cols-2">
        <section aria-labelledby={`score-${surfaceKey}`} className="flex flex-col gap-1.5 rounded-md border border-edge-subtle p-3">
          <h4 id={`score-${surfaceKey}`} className="text-xs font-semibold text-fg">
            Score across scorecard runs
          </h4>
          {scores.length ? (
            <>
              <div className="flex items-center gap-3 text-brand">
                <Sparkline values={scores} width={160} height={32} ariaLabel={`Score from ${scores[0]} to ${scores[scores.length - 1]} over ${scores.length} runs`} />
                <span className="text-xs text-fg-secondary">
                  {scores[0]} → <span className="font-semibold text-fg">{scores[scores.length - 1]}</span>/10
                </span>
              </div>
              <p className="text-2xs text-fg-muted">
                {reused ? `${reused} of ${scores.length} scores reused an earlier verdict (the page had not changed), at no model cost.` : 'Every score was a model call.'}
                {h.scores.some((s) => s.cost_usd != null) && ` Scoring this page cost ${formatCost(h.scores.reduce((n, s) => n + (s.cost_usd ?? 0), 0))} in all.`}
              </p>
            </>
          ) : (
            <p className="text-2xs text-fg-muted">Not scored yet. Run mushi-ux scorecard --sync.</p>
          )}
        </section>
        <section aria-labelledby={`changes-${surfaceKey}`} className="flex flex-col gap-1.5 rounded-md border border-edge-subtle p-3">
          <h4 id={`changes-${surfaceKey}`} className="text-xs font-semibold text-fg">
            Changes the UX loop kept here
          </h4>
          {h.changes.length ? (
            <ul className="flex flex-col gap-1.5">
              {h.changes.slice(0, 8).map((ch, i) => (
                <li key={`${ch.run}-${i}`} className="flex items-start gap-2 text-2xs">
                  <Badge tone={ch.shipped ? 'ok' : 'neutral'}>{ch.shipped ? 'Shipped' : 'On a branch'}</Badge>
                  <span className="min-w-0 flex-1 text-fg-secondary">
                    {ch.what || 'A kept change'}
                    {' · '}
                    {ch.run && isOperator ? (
                      <Link className="text-brand underline underline-offset-2" to={`/ux-runs?run=${encodeURIComponent(ch.run)}`}>
                        {formatRelative(ch.at)}
                      </Link>
                    ) : (
                      <span>{formatRelative(ch.at)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-2xs text-fg-muted">No kept change on this screen yet.</p>
          )}
        </section>
      </div>
      </div>
    </div>
  )
}
