/**
 * FILE: apps/admin/src/lib/recentEntities.ts
 * PURPOSE: Local, privacy-preserving navigation memory for entity pages.
 */

import { useEffect, useState } from 'react'

export type RecentEntityKind = 'report' | 'fix' | 'project'

export interface RecentEntity {
  kind: RecentEntityKind
  id: string
  label: string
  url: string
  at: number
}

const KEY = 'mushi:recent:entities:v1'
const EVENT = 'mushi:recent-entities'
const MAX_PER_KIND = 12
const MAX_TOTAL = 36

function read(): RecentEntity[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is RecentEntity =>
      item &&
      (item.kind === 'report' || item.kind === 'fix' || item.kind === 'project') &&
      typeof item.id === 'string' &&
      typeof item.label === 'string' &&
      typeof item.url === 'string' &&
      typeof item.at === 'number',
    )
  } catch {
    return []
  }
}

function write(items: RecentEntity[]): void {
  window.localStorage.setItem(KEY, JSON.stringify(items))
  window.dispatchEvent(new Event(EVENT))
}

function trim(items: RecentEntity[]): RecentEntity[] {
  const perKind = new Map<RecentEntityKind, number>()
  return items
    .sort((a, b) => b.at - a.at)
    .filter((item) => {
      const count = perKind.get(item.kind) ?? 0
      if (count >= MAX_PER_KIND) return false
      perKind.set(item.kind, count + 1)
      return true
    })
    .slice(0, MAX_TOTAL)
}

export function recordVisit(input: Omit<RecentEntity, 'at'>): void {
  if (typeof window === 'undefined') return
  const next = trim([
    { ...input, at: Date.now() },
    ...read().filter((item) => !(item.kind === input.kind && item.id === input.id)),
  ])
  write(next)
}

export function useRecentEntities(kind?: RecentEntityKind): RecentEntity[] {
  const [items, setItems] = useState<RecentEntity[]>(() => read())

  useEffect(() => {
    const sync = () => setItems(read())
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  return kind ? items.filter((item) => item.kind === kind) : items
}
