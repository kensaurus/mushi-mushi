/**
 * FILE: apps/admin/src/lib/usePersistentState.ts
 * PURPOSE: One small hook for console UI state that should survive a reload:
 *          the last Settings tab, which disclosures are open, list filters,
 *          the sidebar mode. `useState` with a localStorage memory.
 *
 *          Storage contract:
 *            key      `mushi:ui:<projectId>:<key>` when a project is given,
 *                     `mushi:ui:<key>` for console-wide state
 *            value    JSON `{ "v": <version>, "value": <state> }`
 *
 *          - Versioned: bump `version` when the shape of a value changes.
 *            A stored value with another version is ignored, so an old shape
 *            can never crash a new build.
 *          - Every storage access is in try/catch (private windows, blocked
 *            site data and quota errors throw). Any failure means "use the
 *            default", never an error, same posture as lib/accountSessions.ts.
 *          - Re-reads when the key or project changes, so switching projects
 *            shows that project's remembered state instead of the last one's.
 *
 *          This is for per-viewer conveniences only. Anything that must be
 *          shared, reliable or read by the server belongs in the database.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const PREFIX = 'mushi:ui:'

export interface PersistentStateOptions<T> {
  /** Remember the value per project. Omit for console-wide state. */
  projectId?: string | null
  /** Bump when the stored shape changes; older values are then ignored. */
  version?: number
  /** Reject a stored value that is no longer valid (e.g. a removed tab id). */
  validate?: (value: unknown) => value is T
}

export function persistentStorageKey(key: string, projectId?: string | null): string {
  return projectId ? `${PREFIX}${projectId}:${key}` : `${PREFIX}${key}`
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readPersistentValue<T>(
  storageKey: string,
  fallback: T,
  version = 1,
  validate?: (value: unknown) => value is T,
): T {
  try {
    const raw = storage()?.getItem(storageKey)
    if (raw == null) return fallback
    const parsed = JSON.parse(raw) as { v?: unknown; value?: unknown } | null
    if (!parsed || typeof parsed !== 'object' || parsed.v !== version || !('value' in parsed)) {
      return fallback
    }
    if (validate && !validate(parsed.value)) return fallback
    return parsed.value as T
  } catch {
    return fallback
  }
}

export function writePersistentValue(storageKey: string, value: unknown, version = 1): void {
  try {
    storage()?.setItem(storageKey, JSON.stringify({ v: version, value }))
  } catch {
    // Storage blocked or full: the value lives for this session only.
  }
}

/**
 * `useState` that remembers its value in localStorage.
 *
 * @example
 *   const [tab, setTab] = usePersistentState('settings:tab', 'general', { projectId })
 */
export function usePersistentState<T>(
  key: string,
  defaultValue: T,
  options: PersistentStateOptions<T> = {},
): [T, (next: T | ((current: T) => T)) => void] {
  const { projectId, version = 1, validate } = options
  const storageKey = persistentStorageKey(key, projectId)

  // The default and validator are read through refs so callers can pass
  // inline values without re-reading storage on every render.
  const defaultRef = useRef(defaultValue)
  defaultRef.current = defaultValue
  const validateRef = useRef(validate)
  validateRef.current = validate

  const [state, setState] = useState<{ key: string; value: T }>(() => ({
    key: storageKey,
    value: readPersistentValue(storageKey, defaultValue, version, validate),
  }))

  // A new key (another project, another list) reads that key's memory
  // during render, so the first paint after a switch is already correct.
  let current = state
  if (state.key !== storageKey) {
    current = {
      key: storageKey,
      value: readPersistentValue(storageKey, defaultRef.current, version, validateRef.current),
    }
    setState(current)
  }

  const versionRef = useRef(version)
  versionRef.current = version

  const set = useCallback(
    (next: T | ((value: T) => T)) => {
      setState((prev) => {
        const value =
          typeof next === 'function' ? (next as (value: T) => T)(prev.value) : next
        writePersistentValue(prev.key, value, versionRef.current)
        return { key: prev.key, value }
      })
    },
    [],
  )

  // Keep tabs in sync: another tab writing the same key updates this one.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) return
      setState({
        key: storageKey,
        value: readPersistentValue(storageKey, defaultRef.current, versionRef.current, validateRef.current),
      })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [storageKey])

  return [current.value, set]
}
