/**
 * FILE: apps/admin/src/lib/useSavedViews.ts
 * PURPOSE: localStorage-backed saved views for any page that uses URL
 *          search params for its filter/sort state. A "view" is simply
 *          a named snapshot of the current URL query string.
 *
 *          Pattern intentionally dumb: we persist the query string as-is
 *          so upgrading the set of filters doesn't require migrating the
 *          saved-view schema. Server-backed saved views are a future
 *          enhancement; for now every person-team pair gets their own
 *          browser-local list, which is enough to make muscle memory work
 *          ("bring me back to my triage view") without the database cost.
 */

import { useCallback, useEffect, useState } from 'react'

export interface SavedView {
  id: string
  name: string
  /** URL search string (without leading `?`), e.g. `status=new&severity=critical`. */
  query: string
  /** Optional preset icon/tone for the chip — purely decorative. */
  tone?: 'default' | 'brand' | 'ok' | 'warn' | 'danger' | 'info'
  /** Creation timestamp so the UI can order by recency. */
  created_at: string
}

function keyFor(scope: string) {
  return `mushi:views:${scope}:v1`
}

function read(scope: string): SavedView[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(keyFor(scope))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as SavedView[]
  } catch {
    return []
  }
}

function write(scope: string, views: SavedView[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(keyFor(scope), JSON.stringify(views))
  } catch {
    // Out-of-space / private-mode failures leave the list in memory only —
    // acceptable degradation for a decorative feature.
  }
}

export interface UseSavedViewsResult {
  views: SavedView[]
  /** Save the current query as a new view. Returns the created view. */
  save: (name: string, query: string, tone?: SavedView['tone']) => SavedView
  /** Remove a view by id. */
  remove: (id: string) => void
  /** Rename an existing view in-place. */
  rename: (id: string, nextName: string) => void
}

export function useSavedViews(scope: string): UseSavedViewsResult {
  const [views, setViews] = useState<SavedView[]>(() => read(scope))

  // Keep the in-memory state in sync with writes from another tab so a
  // user who saves a view on /reports and flips to a new tab still sees
  // it when they come back to the list.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== keyFor(scope)) return
      setViews(read(scope))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [scope])

  const save = useCallback<UseSavedViewsResult['save']>(
    (name, query, tone) => {
      const view: SavedView = {
        id: (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: name.trim() || 'Untitled view',
        query,
        tone,
        created_at: new Date().toISOString(),
      }
      setViews((prev) => {
        const next = [view, ...prev]
        write(scope, next)
        return next
      })
      return view
    },
    [scope],
  )

  const remove = useCallback(
    (id: string) => {
      setViews((prev) => {
        const next = prev.filter((v) => v.id !== id)
        write(scope, next)
        return next
      })
    },
    [scope],
  )

  const rename = useCallback(
    (id: string, nextName: string) => {
      setViews((prev) => {
        const next = prev.map((v) => (v.id === id ? { ...v, name: nextName.trim() || v.name } : v))
        write(scope, next)
        return next
      })
    },
    [scope],
  )

  return { views, save, remove, rename }
}
