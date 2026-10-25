/**
 * FILE: apps/admin/src/components/dashboard/TileLoadError.tsx
 * PURPOSE: Error state for a dashboard tile that fetches on its own.
 *          Empty lists use the dashed EmptySectionMessage; this is the
 *          failure path (plain sentence + Retry) so a down endpoint is
 *          not shown as "nothing here yet".
 *
 * DEPENDENCIES: Btn, humanizeApiError
 * USAGE: Team activity, platform health, QA coverage tiles.
 */

import { Btn } from '../ui'
import { humanizeApiError } from '../../lib/humanizeApiError'

const GENERIC_TITLES = new Set(['Could not load this page.', 'The server returned an error.'])

interface Props {
  /** What failed, in sentence case after "Couldn't load", e.g. "team activity". */
  resource: string
  error: string
  code?: string | null
  onRetry: () => void
  /**
   * A refresh failed but the last successful payload is still on screen.
   * One line above that payload, not a replacement for it.
   */
  stale?: boolean
}

export function TileLoadError({ resource, error, code, onRetry, stale = false }: Props) {
  if (stale) {
    return (
      <p role="alert" className="mb-2 text-2xs leading-relaxed text-danger">
        Couldn't refresh {resource}. Showing the last result.{' '}
        <button type="button" className="font-medium underline underline-offset-2" onClick={onRetry}>
          Retry
        </button>
      </p>
    )
  }

  const human = humanizeApiError(error, code)
  const specific = human != null && !GENERIC_TITLES.has(human.title)
  const title = specific ? human.title : `Couldn't load ${resource}.`
  const hint = specific
    ? human.hint
    : 'Retry in a moment. If it keeps failing, refresh the page.'

  return (
    <div role="alert" className="rounded-md border border-danger/30 bg-danger-muted/10 px-3 py-2.5">
      <p className="text-xs font-medium leading-relaxed text-danger">{title}</p>
      <p className="mt-1 text-2xs leading-relaxed text-danger">{hint}</p>
      <div className="mt-2">
        <Btn size="sm" variant="ghost" type="button" onClick={onRetry}>
          Retry
        </Btn>
      </div>
    </div>
  )
}
