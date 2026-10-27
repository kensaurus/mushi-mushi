/**
 * FILE: apps/admin/src/lib/projectScope.ts
 * PURPOSE: The header's "All apps" choice: which apps a page shows.
 *
 * Scope is `{ mode: 'project', projectId }` (one app, the default) or
 * `{ mode: 'all' }` (every app the caller can open, combined). All-apps mode
 * sits ON TOP of the active project instead of replacing it:
 *
 *   - `?project=<uuid>` and `mushi:active_project_id` keep the last concrete
 *     app, so `useActiveProjectId()`, `getActiveProjectIdForApi()` and every
 *     page that has not opted in behave exactly as before.
 *   - The all-apps flag lives in its own param, `?apps=all`, and its own
 *     storage key. `?project=all` would not survive: the URL sanitiser and
 *     the switcher's hydrate effect strip any non-UUID `?project=` value, and
 *     apiFetch would lose its project header on every unopted page.
 *
 * Precedence mirrors the project pin: `?apps=all` in the URL wins (shared
 * links), otherwise the stored choice (in-app links drop the query string;
 * ProjectSwitcher writes the param back). Picking an app clears both.
 *
 * Pages opt in through ALL_APPS_ROUTES and read `useProjectScope()`. On any
 * other page Layout shows ProjectScopeNotice: "This page shows one app at a
 * time", never an error.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ACTIVE_PROJECT_QUERY_PARAM,
  getActiveProjectIdSnapshot,
  isValidProjectId,
  useActiveProjectSignal,
} from './activeProject'

export const PROJECT_SCOPE_QUERY_PARAM = 'apps'
/** @internal Exported for tests only. */
export const PROJECT_SCOPE_STORAGE_KEY = 'mushi:project_scope'
export const ALL_APPS_VALUE = 'all'
/** @internal Exported for tests only. */
export const PROJECT_SCOPE_EVENT = 'mushi:project-scope-change'

export type ProjectScope = { mode: 'project'; projectId: string | null } | { mode: 'all' }
type ProjectScopeMode = ProjectScope['mode']

// ── Opt-in registry ─────────────────────────────────────────────────────────

/**
 * Pages that combine every app when "All apps" is chosen. Each one reads
 * `useProjectScope()` and calls an API that aggregates without a project id.
 *
 *   /ci — GET /v1/admin/ci/overview without project_id reads every project
 *         the caller can open (routes/ci.ts, callerProjectIds).
 *   /pipeline — GET /v1/admin/pipeline without projectId reads every
 *         project the caller can open (routes/pipeline.ts).
 *   /reports — the list, severity tiles, quick-filter counts and
 *         /reports/stats?apps=all. The page omits the project pin; rows carry
 *         the app name. Report detail (/reports/:id) stays one report.
 *         Stats aggregate only when that query is sent.
 *
 * Not opted in (their list APIs drop to "all projects" without a project id,
 * but the pages assume one app: rows carry no app name, and actions, filters
 * and counts are per app): /fixes, /releases, /lessons.
 */
const ALL_APPS_ROUTES: readonly string[] = ['/ci', '/pipeline']
/** Exact paths only — a prefix would also opt in /reports/:id. */
const ALL_APPS_EXACT: readonly string[] = ['/reports']

/**
 * Pages that never show one app's data, so the one-app notice would be wrong
 * on them: the account-wide portfolio, the project list, team settings.
 */
const ACCOUNT_WIDE_ROUTE_PREFIXES: readonly string[] = ['/portfolio', '/projects', '/org/']

type AllAppsSupport = 'combined' | 'account' | 'single'

function matchesRoute(pathname: string, route: string): boolean {
  if (route.endsWith('/')) return pathname.startsWith(route)
  return pathname === route || pathname.startsWith(`${route}/`)
}

/** How a route behaves in all-apps mode. */
export function allAppsSupportFor(pathname: string): AllAppsSupport {
  // `/projects/:pid/qa-coverage/:storyId` is one app's story (a redirect).
  if (/^\/projects\/[^/]+\//.test(pathname)) return 'single'
  if (ALL_APPS_EXACT.includes(pathname)) return 'combined'
  if (ALL_APPS_ROUTES.some((r) => matchesRoute(pathname, r))) return 'combined'
  if (ACCOUNT_WIDE_ROUTE_PREFIXES.some((r) => matchesRoute(pathname, r))) return 'account'
  return 'single'
}

// ── Store ───────────────────────────────────────────────────────────────────

function readStoredAllApps(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(PROJECT_SCOPE_STORAGE_KEY) === ALL_APPS_VALUE
  } catch {
    return false
  }
}

/** Stored choice only (the URL can override it; see resolveProjectScopeMode). */
export function getStoredProjectScopeMode(): ProjectScopeMode {
  return readStoredAllApps() ? 'all' : 'project'
}

/** Persist the choice. Idempotent: an unchanged value fires no event. */
export function setStoredProjectScopeMode(mode: ProjectScopeMode): void {
  if (typeof window === 'undefined') return
  if (getStoredProjectScopeMode() === mode) return
  try {
    if (mode === 'all') window.localStorage.setItem(PROJECT_SCOPE_STORAGE_KEY, ALL_APPS_VALUE)
    else window.localStorage.removeItem(PROJECT_SCOPE_STORAGE_KEY)
  } catch {
    // Storage disabled: the URL param still carries the choice.
  }
  window.dispatchEvent(new CustomEvent(PROJECT_SCOPE_EVENT, { detail: { mode } }))
}

function subscribeProjectScope(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (event: StorageEvent) => {
    if (event.key === PROJECT_SCOPE_STORAGE_KEY) listener()
  }
  window.addEventListener(PROJECT_SCOPE_EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(PROJECT_SCOPE_EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

function useStoredProjectScopeMode(): ProjectScopeMode {
  return useSyncExternalStore(subscribeProjectScope, getStoredProjectScopeMode, () => 'project')
}

/**
 * `?apps=all` wins; any other `?apps=` value is ignored; else the stored choice.
 * @internal Exported for tests only.
 */
export function resolveProjectScopeMode(urlValue: string | null, stored: ProjectScopeMode): ProjectScopeMode {
  if (urlValue === ALL_APPS_VALUE) return 'all'
  return stored
}

// ── Hooks ───────────────────────────────────────────────────────────────────

/** Just the mode, for chrome (switcher, notice) that does not need the id. */
export function useProjectScopeMode(): ProjectScopeMode {
  const [searchParams] = useSearchParams()
  const stored = useStoredProjectScopeMode()
  return resolveProjectScopeMode(searchParams.get(PROJECT_SCOPE_QUERY_PARAM), stored)
}

/**
 * Header scope for a combined page's API calls. `enumeration` omits
 * `X-Mushi-Project-Id`, so list endpoints count every app the caller can
 * open. One-app pages must not use this — they keep the pin on purpose.
 */
export function combinedFetchScope(mode: ProjectScopeMode): 'enumeration' | 'project' {
  return mode === 'all' ? 'enumeration' : 'project'
}

/**
 * The scope an opted-in page should show. Pages that are not in
 * ALL_APPS_ROUTES keep using `useActiveProjectId()`, which in all-apps mode
 * still returns the last concrete app.
 */
export function useProjectScope(): ProjectScope {
  const mode = useProjectScopeMode()
  const [searchParams] = useSearchParams()
  // Re-render when the stored project changes (same reads as useActiveProjectId).
  useActiveProjectSignal()
  if (mode === 'all') return { mode: 'all' }
  const fromUrl = searchParams.get(ACTIVE_PROJECT_QUERY_PARAM)
  return { mode: 'project', projectId: isValidProjectId(fromUrl) ? fromUrl : getActiveProjectIdSnapshot() }
}

/** Switch between one app and all apps, in storage and the URL together. */
export function useSetProjectScopeMode(): (mode: ProjectScopeMode) => void {
  const [, setSearchParams] = useSearchParams()
  return useCallback(
    (mode: ProjectScopeMode) => {
      setStoredProjectScopeMode(mode)
      setSearchParams((prev) => withProjectScopeParam(prev, mode), { replace: true })
    },
    [setSearchParams],
  )
}

/** A copy of `params` with `?apps=` set for `mode` (removed for one app). */
function withProjectScopeParam(params: URLSearchParams, mode: ProjectScopeMode): URLSearchParams {
  const next = new URLSearchParams(params)
  if (mode === 'all') next.set(PROJECT_SCOPE_QUERY_PARAM, ALL_APPS_VALUE)
  else next.delete(PROJECT_SCOPE_QUERY_PARAM)
  return next
}

// ── Open the header switcher from elsewhere ─────────────────────────────────

export const OPEN_PROJECT_SWITCHER_EVENT = 'mushi:open-project-switcher'

/** Ask the header's ProjectSwitcher to open its dropdown (the notice's "Switch app"). */
export function requestOpenProjectSwitcher(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(OPEN_PROJECT_SWITCHER_EVENT))
}
