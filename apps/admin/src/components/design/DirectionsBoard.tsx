/**
 * FILE: apps/admin/src/components/design/DirectionsBoard.tsx
 * PURPOSE: The Directions board — every art direction in the repo side by
 *          side (3 columns at ≥1100 px, stacked below), each drawn from its own
 *          tokens. Data: GET /v1/admin/projects/:id/design/directions.
 *
 *          Actions go through POST …/design/changes with the same dry-run →
 *          confirm → draft PR flow as token edits; one action at a time.
 *          The declared families' Google Fonts stylesheets load only while the
 *          board is shown.
 */

import { useCallback, useState } from 'react'
import { ErrorAlert, Loading } from '../ui'
import { usePageData } from '../../lib/usePageData'
import type { DesignDirectionsResponse } from '../../lib/recipeTypes'
import { DirectionCard, type DirectionAction } from './DirectionCard'
import type { DuplicateRequest } from './DuplicateDirectionForm'
import { changeLocksInputs, useDesignChange } from './useDesignChange'
import { useFontStylesheets } from './useFontStylesheets'

export function DirectionsBoard({ projectId }: { projectId: string }) {
  const path = `/v1/admin/projects/${projectId}/design/directions`
  const { data, loading, error, reload } = usePageData<DesignDirectionsResponse>(path)

  if (error) return <ErrorAlert message={error} endpoint={path} onRetry={reload} />
  if (loading && !data) return <Loading text="Loading directions…" />
  if (!data) return null
  return <DirectionsBoardView projectId={projectId} data={data} />
}

/** @internal Exported for tests; the page renders `DirectionsBoard`. */
export function DirectionsBoardView({ projectId, data }: { projectId: string; data: DesignDirectionsResponse }) {
  useFontStylesheets(data.fontStylesheets)
  const change = useDesignChange(projectId)
  const { preview, confirm, reset } = change
  const [action, setAction] = useState<DirectionAction>(null)
  const locked = changeLocksInputs(change.state)

  const startAction = useCallback(
    (next: NonNullable<DirectionAction>) => {
      reset()
      setAction(next)
    },
    [reset],
  )
  const clearAction = useCallback(() => {
    reset()
    setAction(null)
  }, [reset])
  const activate = useCallback((direction: string) => void preview({ kind: 'activate', direction }), [preview])
  const duplicate = useCallback((req: DuplicateRequest) => void preview({ kind: 'duplicate', ...req }), [preview])

  if (data.directions.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        No art directions found. Put each direction&apos;s token files in its own <span className="font-mono">directions/&lt;name&gt;/</span>{' '}
        folder and point mushi.recipe.json at the active one.
      </p>
    )
  }

  const names = data.directions.map((d) => d.name)

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-fg-muted">
        {data.directions.length} directions, each drawn from its own tokens on the same lesson moment.
        {data.activeDirection ? (
          <>
            {' '}
            Active: <span className="font-mono">{data.activeDirection}</span>.
          </>
        ) : (
          ' No direction is active.'
        )}{' '}
        Fonts load from Google Fonts; a family it does not serve falls back to your system font.
      </p>
      <div
        className="grid min-w-0 grid-cols-1 border-y border-edge min-[1100px]:grid-cols-3"
        data-testid="directions-board"
      >
        {data.directions.map((d) => (
          <DirectionCard
            key={d.name}
            direction={d}
            specimen={data.specimen}
            editable={data.editable}
            existingNames={names}
            action={action}
            change={change.state}
            locked={locked}
            onStartAction={startAction}
            onCancelAction={clearAction}
            onActivate={activate}
            onDuplicate={duplicate}
            onConfirm={() => void confirm()}
            onDiscard={clearAction}
          />
        ))}
      </div>
    </div>
  )
}
