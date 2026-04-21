/**
 * FILE: apps/admin/src/lib/useTableDensity.ts
 * PURPOSE: Per-user table density preference ('comfy' | 'compact') persisted
 *          in localStorage under `mushi:table-density:v1`. Shared across
 *          every `ResponsiveTable` so once the user chooses compact rows on
 *          one table, every table in the app follows.
 */

import { useCallback, useEffect, useState } from 'react'

export type TableDensity = 'comfy' | 'compact'

const STORAGE_KEY = 'mushi:table-density:v1'
const DEFAULT: TableDensity = 'comfy'

function readStored(): TableDensity {
  if (typeof window === 'undefined') return DEFAULT
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw === 'compact' ? 'compact' : 'comfy'
  } catch {
    return DEFAULT
  }
}

const listeners = new Set<(d: TableDensity) => void>()
let currentDensity: TableDensity | null = null

function getCurrent(): TableDensity {
  if (currentDensity === null) currentDensity = readStored()
  return currentDensity
}

function setCurrent(next: TableDensity) {
  currentDensity = next
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // localStorage may be unavailable (private mode, SSR) — in-memory only.
  }
  for (const fn of listeners) fn(next)
}

export function useTableDensity(): [TableDensity, (d: TableDensity) => void] {
  const [density, setDensity] = useState<TableDensity>(getCurrent)

  useEffect(() => {
    const listener = (d: TableDensity) => setDensity(d)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  const update = useCallback((next: TableDensity) => {
    setCurrent(next)
  }, [])

  return [density, update]
}
