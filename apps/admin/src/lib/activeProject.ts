/**
 * FILE: apps/admin/src/lib/activeProject.ts
 * PURPOSE: Single source of truth for the admin console's active project id.
 *
 * ProjectSwitcher owns the visible control, but API helpers and data hooks also
 * need a synchronous read so unscoped endpoints can carry the active project to
 * the backend. Keeping storage/event plumbing here avoids each caller inventing
 * its own localStorage key or forgetting to invalidate on project changes.
 */

import { useSyncExternalStore } from 'react'

export const ACTIVE_PROJECT_STORAGE_KEY = 'mushi:active_project_id'
export const ACTIVE_PROJECT_QUERY_PARAM = 'project'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidProjectId(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function clearActiveProject(): void {
  pendingPick = null
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY)
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(ACTIVE_PROJECT_EVENT, { detail: { projectId: null } }))
}

/** @internal Exported for tests only. */
export const ACTIVE_PROJECT_EVENT = 'mushi:active-project-change'
const SERVER_SNAPSHOT = '__server__'

function readStorage(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY)
  } catch {
    return null
  }
}

export function getActiveProjectIdSnapshot(): string | null {
  const raw = readStorage()
  if (!raw) return null
  if (!isValidProjectId(raw)) {
    try {
      window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY)
    } catch {
      // ignore
    }
    return null
  }
  return raw
}

/** Read `?project=` from the current URL when valid. */
export function getActiveProjectIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const fromUrl = new URLSearchParams(window.location.search).get(ACTIVE_PROJECT_QUERY_PARAM)
    return isValidProjectId(fromUrl) ? fromUrl : null
  } catch {
    return null
  }
}

/**
 * An app the person just picked in the header switcher, until the URL moves.
 * The pick stores the app and fires ACTIVE_PROJECT_EVENT, which refetches every
 * panel at once, but the URL only changes on the next render. Those refetches
 * used to read the old URL, so Fixes showed glot.it's 629 fixes under a
 * "mushi-mushi" header (2026-11-16). Only an explicit pick (`pickActiveProject`)
 * does this: a background store write never overrides the URL (a report page
 * stays on the app its link names).
 */
let pendingPick: { id: string; urlAtPick: string | null; at: number } | null = null
/** A pick the URL never adopts (a cancelled navigation) stops winning after this. */
const PENDING_PICK_MS = 5_000

if (typeof window !== 'undefined') {
  // Back/forward means the URL is the user's choice again.
  window.addEventListener('popstate', () => {
    pendingPick = null
  })
}

/**
 * Effective project for API calls: a pick the URL has not caught up with yet,
 * else the URL param (deep links and report pages stay scoped even when the
 * header pin lags), else localStorage.
 */
export function getActiveProjectIdForApi(): string | null {
  const fromUrl = getActiveProjectIdFromUrl()
  if (pendingPick) {
    // The URL moved (to the pick, or anywhere else), the pick was replaced or
    // cleared, or it is old: the URL is the answer again.
    const moved = fromUrl !== pendingPick.urlAtPick
    const replaced = getActiveProjectIdSnapshot() !== pendingPick.id
    if (moved || replaced || Date.now() - pendingPick.at > PENDING_PICK_MS) pendingPick = null
    else return pendingPick.id
  }
  return fromUrl ?? getActiveProjectIdSnapshot()
}

/**
 * The person picked this app (header switcher): store it, and let API calls
 * follow it until the URL catches up. Use `setActiveProjectIdSnapshot` for
 * any write that is not a person's pick.
 */
export function pickActiveProject(projectId: string): void {
  const urlAtPick = getActiveProjectIdFromUrl()
  pendingPick = urlAtPick === projectId ? null : { id: projectId, urlAtPick, at: Date.now() }
  setActiveProjectIdSnapshot(projectId)
}

export function setActiveProjectIdSnapshot(projectId: string): void {
  if (typeof window === 'undefined') return
  // Idempotence guard: two writers hydrate this store (ReportDetailPage from
  // the report row, ProjectSwitcher from the URL). Without this check a
  // mismatched `?project=` ping-pongs between them — every write fires the
  // CustomEvent, every event cache-busts every usePageData hook, and the
  // report page re-render-loops forever (the "page keeps refreshing" bug).
  if (getActiveProjectIdSnapshot() === projectId) return
  try {
    window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, projectId)
  } catch {
    // Private browsing or storage-disabled environments still get the URL param.
  }
  window.dispatchEvent(new CustomEvent(ACTIVE_PROJECT_EVENT, { detail: { projectId } }))
}

/** @internal Exported for tests only. */
export function subscribeActiveProject(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const onActiveProject = () => listener()
  const onStorage = (event: StorageEvent) => {
    if (event.key === ACTIVE_PROJECT_STORAGE_KEY) listener()
  }

  window.addEventListener(ACTIVE_PROJECT_EVENT, onActiveProject)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(ACTIVE_PROJECT_EVENT, onActiveProject)
    window.removeEventListener('storage', onStorage)
  }
}

// ── Project data epoch ──────────────────────────────────────────────────────
//
// API calls take the project from `?project=` before localStorage
// (getActiveProjectIdForApi). When only the URL changes, e.g. a stale link is
// replaced by a project the user can open while storage already held that
// project, the stored value does not change, no ACTIVE_PROJECT_EVENT fires,
// and every panel keeps the error from the stale id. Bumping this epoch makes
// the data hooks refetch.
const PROJECT_DATA_EPOCH_EVENT = 'mushi:project-data-epoch'
let projectDataEpoch = 0

/** Make every project-scoped data hook refetch (after a URL-only project change). */
export function refetchProjectData(): void {
  if (typeof window === 'undefined') return
  projectDataEpoch += 1
  window.dispatchEvent(new Event(PROJECT_DATA_EPOCH_EVENT))
}

function subscribeProjectDataEpoch(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(PROJECT_DATA_EPOCH_EVENT, listener)
  return () => window.removeEventListener(PROJECT_DATA_EPOCH_EVENT, listener)
}

export function useProjectDataEpoch(): number {
  return useSyncExternalStore(subscribeProjectDataEpoch, () => projectDataEpoch, () => 0)
}

/**
 * React-friendly signal used by data hooks. The return value changes whenever
 * ProjectSwitcher updates the active project, forcing GET hooks to refetch even
 * when their path string stays the same (for example `/v1/admin/settings`).
 */
export function useActiveProjectSignal(): string {
  return useSyncExternalStore(
    subscribeActiveProject,
    () => getActiveProjectIdSnapshot() ?? '',
    () => SERVER_SNAPSHOT,
  )
}
