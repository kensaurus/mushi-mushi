/**
 * FILE: apps/admin/src/components/recipe/recipeState.ts
 * PURPOSE: Pure presentation rules for the App Recipe page (Plan 019 §3):
 *          the five element states → chip tone, glyph and label, the lane
 *          taxonomy, and a stable element order for the list fallback.
 *
 *          Fail-closed by construction: `elementStateMeta()` is a switch whose
 *          DEFAULT branch is `unknown`. A state the console does not recognise
 *          (a new server value, a typo, `"constructor"`) renders as unknown —
 *          never as ok, and `unknown` never uses a green tone.
 */

import { RECIPE_ELEMENT_KEYS } from '../../lib/recipeTypes'
import type {
  ElementState,
  RecipeElementKey,
  RecipeElementSummary,
  RecipeLane,
} from '../../lib/recipeTypes'
import type { CHIP_TONE } from '../../lib/chipTone'

export type StateGlyph = 'check' | 'triangle' | 'question' | 'ring' | 'cross'

export interface ElementStateMeta {
  /** Canonical state after normalisation (an unrecognised value becomes `unknown`). */
  state: ElementState
  label: string
  /** CHIP_TONE key — never an ok tone for anything but `ok`. */
  tone: keyof typeof CHIP_TONE
  /** Shape that carries the state without colour. */
  glyph: StateGlyph
  /** One line for tooltips / screen readers. */
  description: string
  /** Card outline: dashed for "not observed", heavier for problems. */
  cardEdge: string
}

const OK: ElementStateMeta = {
  state: 'ok',
  label: 'OK',
  tone: 'okSubtle',
  glyph: 'check',
  description: 'Checked recently and matches what the app declares.',
  cardEdge: 'border border-edge-subtle',
}

const DRIFT: ElementStateMeta = {
  state: 'drift',
  label: 'Drift',
  tone: 'warnSubtle',
  glyph: 'triangle',
  description: 'Reality differs from what the app declares.',
  cardEdge: 'border-2 border-warn/60',
}

const UNKNOWN: ElementStateMeta = {
  state: 'unknown',
  label: 'Unknown',
  tone: 'neutral',
  glyph: 'question',
  description: 'Configured, but never observed or not observed recently. Not a pass.',
  cardEdge: 'border-2 border-dashed border-edge',
}

const NOT_CONNECTED: ElementStateMeta = {
  state: 'not_connected',
  label: 'Not connected',
  tone: 'neutral',
  glyph: 'ring',
  description: 'Nothing is configured for this element yet.',
  cardEdge: 'border border-dashed border-edge-subtle',
}

const ERROR: ElementStateMeta = {
  state: 'error',
  label: 'Error',
  tone: 'dangerSubtle',
  glyph: 'cross',
  description: 'The last check failed, so the state cannot be trusted.',
  cardEdge: 'border-2 border-danger/60',
}

/**
 * Map any server value to its presentation. Explicit switch, not a lookup
 * table, so prototype keys and new values cannot resolve to anything but the
 * `unknown` default.
 */
export function elementStateMeta(raw: unknown): ElementStateMeta {
  switch (raw) {
    case 'ok':
      return OK
    case 'drift':
      return DRIFT
    case 'not_connected':
      return NOT_CONNECTED
    case 'error':
      return ERROR
    case 'unknown':
      return UNKNOWN
    default:
      return UNKNOWN
  }
}

const SEVERITY_RANK: Record<ElementState, number> = {
  error: 4,
  drift: 3,
  unknown: 2,
  not_connected: 1,
  ok: 0,
}

/**
 * Worst of several states (error > drift > unknown > not_connected > ok),
 * each normalised first — so an unrecognised value counts as unknown, and the
 * header can never claim OK while a card on the page shows something worse.
 */
export function worstState(states: readonly unknown[]): ElementState {
  if (states.length === 0) return 'unknown'
  let worst: ElementState = 'ok'
  for (const raw of states) {
    const s = elementStateMeta(raw).state
    if (SEVERITY_RANK[s] > SEVERITY_RANK[worst]) worst = s
  }
  return worst
}

export const RECIPE_LANES: ReadonlyArray<{ id: RecipeLane; label: string; hint: string }> = [
  { id: 'sources', label: 'Sources', hint: 'Schema, design system, routes and stories' },
  { id: 'build', label: 'Build', hint: 'Gates and CI/CD' },
  { id: 'deploy', label: 'Deploy', hint: 'Build and deploy targets' },
  { id: 'runtime', label: 'Runtime', hint: 'Env presence and integrations' },
]

/** Lane each element sits in on the canvas (fixed layout, Plan 019 §3). */
export const ELEMENT_LANE: Record<RecipeElementKey, RecipeLane> = {
  schema: 'sources',
  design: 'sources',
  routes: 'sources',
  gates: 'build',
  ci: 'build',
  deploy: 'deploy',
  env: 'runtime',
  integrations: 'runtime',
}

const FALLBACK_LABEL: Record<RecipeElementKey, string> = {
  schema: 'Schema',
  design: 'Design system',
  routes: 'Routes & stories',
  gates: 'Gates',
  ci: 'CI/CD',
  deploy: 'Deploy',
  env: 'Env',
  integrations: 'Integrations',
}

/**
 * The 8 elements in canonical lane order. A key the server left out renders
 * as an `unknown` placeholder card instead of disappearing (or turning green).
 */
export function orderedRecipeElements(
  elements: Partial<Record<RecipeElementKey, RecipeElementSummary>> | null | undefined,
): RecipeElementSummary[] {
  return RECIPE_ELEMENT_KEYS.map((key) => {
    const found = elements?.[key]
    if (found) return found
    return {
      key,
      label: FALLBACK_LABEL[key],
      lane: ELEMENT_LANE[key],
      state: 'unknown',
      reason: 'The server did not return this element.',
      lastCheckedAt: null,
      facts: {},
      findingsCount: 0,
      links: [],
    }
  })
}

/** "3 hours ago" / "Never checked" — a null or unparseable stamp is never the epoch. */
export function describeLastChecked(
  iso: string | null | undefined,
  formatRelative: (d: Date) => string,
): { text: string; title: string | undefined } {
  if (!iso) return { text: 'Never checked', title: undefined }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { text: 'Check time unknown', title: iso }
  return { text: `Checked ${formatRelative(d)}`, title: d.toLocaleString() }
}

/** Card fact value → short display string. */
export function formatFactValue(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return Number.isFinite(v) ? v.toLocaleString() : String(v)
  return v
}

/** `camelCase` / `snake_case` key → "Camel case". */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase()
  return spaced.length > 0 ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key
}

/** How a server-supplied link target may render: in-app route, external https, or plain text. */
export function classifyLinkTarget(to: string): 'internal' | 'external' | 'text' {
  if (to.startsWith('/') && !to.startsWith('//')) return 'internal'
  if (/^https:\/\//i.test(to)) return 'external'
  return 'text'
}
