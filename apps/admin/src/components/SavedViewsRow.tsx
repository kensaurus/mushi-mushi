/**
 * FILE: apps/admin/src/components/SavedViewsRow.tsx
 * PURPOSE: Thin presentation layer on top of useSavedViews. Renders the
 *          saved-view list as chips plus a "+" control that prompts for
 *          a name and snapshots the current URL query.
 *
 *          Keeping the UI dumb — no modal, no drag-to-reorder — because
 *          the core value is muscle memory: "the view I triage Mondays
 *          with" should be one click away and indistinguishable from a
 *          filter chip.
 */

import { useCallback } from 'react'
import { FilterChip } from './ui'
import { useSavedViews, type SavedView } from '../lib/useSavedViews'

interface Props {
  /** Opaque key for localStorage, e.g. `reports`, `fixes`. */
  scope: string
  /** Current URL query string (without `?`). */
  currentQuery: string
  /** Called when the user clicks a saved chip — parent should apply
   *  the query to the page. Receives the raw `query` string so the
   *  caller can merge/replace as it wishes. */
  onApply: (query: string) => void
  /** Optional: predicate to determine if a saved view matches the
   *  current page state. Defaults to exact string match. */
  isActive?: (view: SavedView, currentQuery: string) => boolean
}

export function SavedViewsRow({ scope, currentQuery, onApply, isActive }: Props) {
  const { views, save, remove } = useSavedViews(scope)

  const activeCheck = useCallback(
    (v: SavedView) => (isActive ? isActive(v, currentQuery) : v.query === currentQuery),
    [isActive, currentQuery],
  )

  const handleSave = useCallback(() => {
    const name = window.prompt(
      'Name this view (e.g. "Critical untriaged", "My assignments")',
      '',
    )
    if (!name) return
    save(name, currentQuery)
  }, [save, currentQuery])

  const handleRemove = useCallback(
    (id: string, name: string) => {
      if (!window.confirm(`Remove saved view "${name}"?`)) return
      remove(id)
    },
    [remove],
  )

  if (views.length === 0) {
    return (
      <div className="mb-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleSave}
          className="inline-flex items-center gap-1 rounded-full border border-edge/60 px-2.5 py-1 text-2xs font-medium text-fg-muted hover:text-fg hover:bg-surface-overlay/60 motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          title="Save the current filters as a named view. Persists in your browser."
        >
          <span aria-hidden className="text-sm leading-none">+</span>
          <span>Save view</span>
        </button>
      </div>
    )
  }

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Saved views">
      <span className="text-2xs uppercase tracking-wider text-fg-faint">Views</span>
      {views.map((v) => {
        const active = activeCheck(v)
        return (
          <span key={v.id} className="group relative inline-flex items-center">
            <FilterChip
              label={v.name}
              active={active}
              onClick={() => onApply(v.query)}
              tone={v.tone ?? 'default'}
              hint={`Apply saved filters: ?${v.query || '(no filters)'}`}
            />
            <button
              type="button"
              onClick={() => handleRemove(v.id, v.name)}
              aria-label={`Remove saved view ${v.name}`}
              className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-fg-faint opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 hover:text-danger focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-danger/60"
            >
              <span aria-hidden className="text-2xs leading-none">×</span>
            </button>
          </span>
        )
      })}
      <button
        type="button"
        onClick={handleSave}
        className="ml-1 inline-flex items-center gap-1 rounded-full border border-edge/60 px-2 py-1 text-2xs font-medium text-fg-muted hover:text-fg hover:bg-surface-overlay/60 motion-safe:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        title="Save current filters as a new view"
      >
        <span aria-hidden className="text-sm leading-none">+</span>
      </button>
    </div>
  )
}
