/**
 * FILE: apps/admin/src/lib/funnelBuilder.ts
 * PURPOSE: Pure helpers behind the Users & Funnels builder — ordered step
 *          editing, query-string construction for
 *          `GET /v1/admin/events/funnel`, and per-project saved funnels in
 *          localStorage (v1). No React, no fetch, so the ordering rules are
 *          unit-testable.
 */

export type FunnelWindow = '1h' | '1d' | '7d' | '30d'

export const FUNNEL_WINDOWS: ReadonlyArray<{ value: FunnelWindow; label: string }> = [
  { value: '1h', label: 'within 1 hour' },
  { value: '1d', label: 'within 1 day' },
  { value: '7d', label: 'within 7 days' },
  { value: '30d', label: 'within 30 days' },
]

/** Mirrors the server cap (`product_funnel` accepts ≤ 8 steps). */
export const FUNNEL_MAX_STEPS = 8
const FUNNEL_MIN_STEPS = 2

/** Same regex the SDK and the ingest route validate event names against. */
const EVENT_NAME_RE = /^[a-z][a-z0-9_]{1,63}$/

export interface FunnelDefinition {
  id: string
  name: string
  steps: string[]
  window: FunnelWindow
  /** Property name to split the funnel by (server `breakdown=`), or null. */
  breakdown: string | null
}

/** Setup → Aha, from the dogfooding taxonomy (analytics-taxonomy.ts). */
export const SIGNUP_ACTIVATED_PRESET: FunnelDefinition = {
  id: 'preset:signup-activated',
  name: 'Signup → Activated',
  steps: ['signup_completed', 'project_created', 'first_report_received'],
  window: '7d',
  breakdown: null,
}

export function emptyFunnel(): FunnelDefinition {
  return { id: 'draft', name: '', steps: [], window: '7d', breakdown: null }
}

export function isValidEventName(name: string): boolean {
  return EVENT_NAME_RE.test(name)
}

/** Append a step. Ignores duplicates, invalid names, and the 8-step cap;
 *  never mutates the input. */
export function addStep(steps: readonly string[], name: string): string[] {
  const trimmed = name.trim()
  if (!isValidEventName(trimmed)) return [...steps]
  if (steps.includes(trimmed)) return [...steps]
  if (steps.length >= FUNNEL_MAX_STEPS) return [...steps]
  return [...steps, trimmed]
}

export function removeStep(steps: readonly string[], index: number): string[] {
  if (index < 0 || index >= steps.length) return [...steps]
  return steps.filter((_, i) => i !== index)
}

/** Move a step to a new index, clamping both ends. Order is the funnel. */
export function moveStep(steps: readonly string[], from: number, to: number): string[] {
  if (from < 0 || from >= steps.length) return [...steps]
  const target = Math.max(0, Math.min(steps.length - 1, to))
  if (from === target) return [...steps]
  const next = [...steps]
  const [item] = next.splice(from, 1)
  next.splice(target, 0, item)
  return next
}

export function canRunFunnel(steps: readonly string[]): boolean {
  return steps.length >= FUNNEL_MIN_STEPS && steps.length <= FUNNEL_MAX_STEPS
}

export interface FunnelRange {
  from?: string | null
  to?: string | null
}

/** Query string (without `?`) for `GET /v1/admin/events/funnel`. */
export function buildFunnelQuery(def: Pick<FunnelDefinition, 'steps' | 'window' | 'breakdown'>, range?: FunnelRange): string {
  const params = new URLSearchParams()
  params.set('steps', def.steps.join(','))
  params.set('window', def.window)
  const breakdown = def.breakdown?.trim()
  if (breakdown) params.set('breakdown', breakdown)
  if (range?.from) params.set('from', range.from)
  if (range?.to) params.set('to', range.to)
  return params.toString()
}

// ─── Saved funnels (localStorage v1, keyed by project) ───────────────────────

const STORAGE_VERSION = 1

export interface FunnelStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** @internal Exported for unit tests only. */
export function savedFunnelsKey(projectId: string): string {
  return `mushi:funnels:v${STORAGE_VERSION}:${projectId}`
}

function defaultStorage(): FunnelStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isFunnelWindow(value: unknown): value is FunnelWindow {
  return FUNNEL_WINDOWS.some((w) => w.value === value)
}

function coerceDefinition(raw: unknown): FunnelDefinition | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.id !== 'string' || typeof obj.name !== 'string') return null
  if (!Array.isArray(obj.steps)) return null
  const steps = obj.steps.filter((s): s is string => typeof s === 'string' && isValidEventName(s))
  if (!isFunnelWindow(obj.window)) return null
  const breakdown = typeof obj.breakdown === 'string' && obj.breakdown.trim() ? obj.breakdown.trim() : null
  return { id: obj.id, name: obj.name, steps, window: obj.window, breakdown }
}

export function loadSavedFunnels(projectId: string, storage: FunnelStorage | null = defaultStorage()): FunnelDefinition[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(savedFunnelsKey(projectId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(coerceDefinition).filter((d): d is FunnelDefinition => d != null)
  } catch {
    return []
  }
}

function writeSavedFunnels(projectId: string, list: FunnelDefinition[], storage: FunnelStorage | null): void {
  if (!storage) return
  try {
    if (list.length === 0) storage.removeItem(savedFunnelsKey(projectId))
    else storage.setItem(savedFunnelsKey(projectId), JSON.stringify(list))
  } catch {
    /* quota / private mode — saved funnels are a convenience, never load-bearing */
  }
}

/** Upsert by id; returns the new list. Presets are never persisted. */
export function saveFunnel(
  projectId: string,
  def: FunnelDefinition,
  storage: FunnelStorage | null = defaultStorage(),
): FunnelDefinition[] {
  if (def.id.startsWith('preset:')) return loadSavedFunnels(projectId, storage)
  const current = loadSavedFunnels(projectId, storage)
  const idx = current.findIndex((d) => d.id === def.id)
  const next = idx === -1 ? [...current, def] : current.map((d, i) => (i === idx ? def : d))
  writeSavedFunnels(projectId, next, storage)
  return next
}

export function deleteSavedFunnel(
  projectId: string,
  id: string,
  storage: FunnelStorage | null = defaultStorage(),
): FunnelDefinition[] {
  const next = loadSavedFunnels(projectId, storage).filter((d) => d.id !== id)
  writeSavedFunnels(projectId, next, storage)
  return next
}

export function newFunnelId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `funnel:${crypto.randomUUID()}`
  }
  return `funnel:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}
