/**
 * FILE: apps/admin/src/lib/useDocumentTitle.ts
 * PURPOSE: Keep `document.title` in sync with the active page, using the
 *          existing `pageContext` registry as the authoritative source
 *          and navRegistry-derived route labels as the fallback for pages
 *          that haven't (yet) opted into `usePublishPageContext`.
 *
 *          Title shape (composed):
 *
 *            ${contextTitle}${summary ? ` · ${summary}` : ''} — Mushi Mushi
 *
 *          Route fallbacks come from `routeFallbackTitle()` in navRegistry.ts
 *          so sidebar / palette / tab labels never drift.
 *
 *          Call this exactly once, from `<Layout>`.
 */

import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { routeFallbackTitle } from './navRegistry'
import { hubViewLabel } from './pageHubs'
import { usePageContext } from './pageContext'

const APP_SUFFIX = 'Mushi Mushi'
const DEFAULT_TITLE = 'Mushi Mushi — Bug Intelligence for Software Teams'

/** The route's sidebar name, plus the hub view when it is not the first ("Team · Billing"). */
function fallbackTitle(pathname: string, search: string): string | null {
  const page = routeFallbackTitle(pathname)
  const view = page ? hubViewLabel(pathname, search) : null
  return page && view ? `${page} · ${view}` : page
}

function composeTitle(primary: string | null, summary?: string | null): string {
  if (!primary) return DEFAULT_TITLE
  const trimmedSummary = summary?.trim() ?? ''
  const body = trimmedSummary ? `${primary} · ${trimmedSummary}` : primary
  return `${body} — ${APP_SUFFIX}`
}

/**
 * Subscribe to pageContext + route and keep `document.title` updated.
 *
 * Writes are coalesced into a single rAF callback per change so rapid
 * summary updates (e.g. typing in a filter) can't thrash the title and
 * trigger the browser's tab-title animation repeatedly. On unmount we
 * restore the document default.
 */
export function useDocumentTitle(): void {
  const ctx = usePageContext()
  const { pathname, search } = useLocation()
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    // Prefer the publisher's title only when its `route` matches the
    // current pathname — this guards against a brief stale frame right
    // after navigation where the old page's context is still resident.
    const ctxMatches = ctx && (ctx.route === pathname || pathname.startsWith(ctx.route + '/'))
    const primary = ctxMatches ? ctx.title : fallbackTitle(pathname, search)
    const summary = ctxMatches ? ctx.summary : undefined
    const next = composeTitle(primary, summary)

    if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      if (document.title !== next) document.title = next
    })

    return () => {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [ctx, pathname, search])

  // Restore the document default on unmount of whatever component (Layout)
  // calls this hook. Practically this only runs on full sign-out / route
  // away from the authenticated shell.
  useEffect(() => {
    return () => {
      document.title = DEFAULT_TITLE
    }
  }, [])
}
