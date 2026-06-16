import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { Btn, Card } from '../ui'
import { ExploreUnderstandEmpty } from './ExploreUnderstandEmpty'
import type { CodebaseUnderstandError, TourStop } from './exploreUnderstandTypes'

interface Props {
  projectId: string
  activeStopOrder: number | null
  onSelectStop: (stop: TourStop) => void
  onStartTour?: () => void
}

export function ExploreTourPanel({ projectId, activeStopOrder, onSelectStop, onStartTour }: Props) {
  const [stops, setStops] = useState<TourStop[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<CodebaseUnderstandError | null>(null)

  const load = useCallback(async (force = false) => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    const res = await apiFetch<{ stops: TourStop[] }>(
      `/v1/admin/projects/${projectId}/codebase/tour${force ? '?force=1' : ''}`,
    )
    setLoading(false)
    if (!res.ok) {
      setError(
        res.error ?? { code: 'LOAD_FAILED', message: 'Failed to load tour' },
      )
      return
    }
    setStops(res.data?.stops ?? [])
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  if (error && (error.code === 'NO_LLM_KEY' || error.code === 'INDEX_DISABLED')) {
    return <ExploreUnderstandEmpty error={error} onRetry={() => void load()} />
  }

  if (loading && stops.length === 0) {
    return (
      <Card className="p-4 animate-pulse" aria-hidden>
        <div className="h-4 w-40 rounded bg-surface-overlay mb-3" />
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded bg-surface-overlay/60" />
          ))}
        </div>
      </Card>
    )
  }

  if (stops.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-sm text-fg-muted">No tour stops yet — index the repo first.</p>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-fg-secondary">
          Dependency-ordered walkthrough — click a stop to highlight files on the Graph tab.
        </p>
        <div className="flex gap-2">
          {onStartTour && (
            <Btn size="sm" variant="primary" onClick={onStartTour}>
              Start tour on Graph
            </Btn>
          )}
          <Btn size="sm" variant="ghost" onClick={() => void load(true)} loading={loading}>
            Regenerate
          </Btn>
        </div>
      </div>

      <ol className="space-y-2">
        {stops.map((stop) => {
          const active = activeStopOrder === stop.order
          return (
            <li key={stop.order}>
              <button
                type="button"
                onClick={() => onSelectStop(stop)}
                className={[
                  'w-full text-left rounded-md border px-3 py-2.5 transition-colors',
                  active
                    ? 'border-brand/50 bg-brand/10 shadow-sm'
                    : 'border-edge-subtle bg-surface-overlay/30 hover:border-brand/30 hover:bg-surface-overlay/60',
                ].join(' ')}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-3xs font-mono text-brand tabular-nums shrink-0">
                    {String(stop.order).padStart(2, '0')}
                  </span>
                  <span className="text-sm font-medium text-fg">{stop.title}</span>
                  <span className="text-3xs text-fg-faint ml-auto uppercase">{stop.layer}</span>
                </div>
                <p className="mt-1 text-xs text-fg-muted line-clamp-3">{stop.rationale}</p>
                <p className="mt-1 text-3xs font-mono text-fg-faint truncate">
                  {stop.file_paths.slice(0, 3).join(' · ')}
                  {stop.file_paths.length > 3 ? ` +${stop.file_paths.length - 3}` : ''}
                </p>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
