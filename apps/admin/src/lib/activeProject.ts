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
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY)
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(ACTIVE_PROJECT_EVENT, { detail: { projectId: null } }))
}

const ACTIVE_PROJECT_EVENT = 'mushi:active-project-change'
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
 * Effective project for API calls: URL param wins over localStorage so deep
 * links and report detail pages stay scoped even when the header pin lags.
 */
export function getActiveProjectIdForApi(): string | null {
  return getActiveProjectIdFromUrl() ?? getActiveProjectIdSnapshot()
}

export function setActiveProjectIdSnapshot(projectId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, projectId)
  } catch {
    // Private browsing or storage-disabled environments still get the URL param.
  }
  window.dispatchEvent(new CustomEvent(ACTIVE_PROJECT_EVENT, { detail: { projectId } }))
}

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
