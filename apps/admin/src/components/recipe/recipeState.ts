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
 *
 *          Labels are plain English ("Needs attention", "Not checked yet",
 *          "Not set up"); the state ids stay as the server sends them.
 *          An element can never read OK without a check time
 *          (`orderedRecipeElements`), and an unknown element that WAS checked
 *          reads "Not confirmed", never "Not checked yet" next to "Checked 3
 *          days ago".
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
  description: 'Checked recently, and nothing needs fixing.',
  cardEdge: 'border border-edge-subtle',
}

const DRIFT: ElementStateMeta = {
  state: 'drift',
  label: 'Needs attention',
  tone: 'warnSubtle',
  glyph: 'triangle',
  description: 'Something here does not match what your app expects. The card says what and how to fix it.',
  cardEdge: 'border-2 border-warn/60',
}

const UNKNOWN: ElementStateMeta = {
  state: 'unknown',
  label: 'Not checked yet',
  tone: 'neutral',
  glyph: 'question',
  description: 'Mushi has not checked this yet, so it is not a pass.',
  cardEdge: 'border-2 border-dashed border-edge',
}

/** `unknown` for an element that WAS checked: the result is old or could not decide. */
const UNCONFIRMED: ElementStateMeta = {
  ...UNKNOWN,
  label: 'Not confirmed',
  description: 'Checked, but the result is out of date or could not decide. Not a pass.',
}

const NOT_CONNECTED: ElementStateMeta = {
  state: 'not_connected',
  label: 'Not set up',
  tone: 'neutral',
  glyph: 'ring',
  description: 'Not set up yet. It is optional; the card says how to set it up.',
  cardEdge: 'border border-dashed border-edge-subtle',
}

const ERROR: ElementStateMeta = {
  state: 'error',
  label: 'Check failed',
  tone: 'dangerSubtle',
  glyph: 'cross',
  description: 'The last check could not finish, so Mushi cannot say if this works.',
  cardEdge: 'border-2 border-danger/60',
}

/**
 * Map any server value to its presentation. Explicit switch, not a lookup
 * table, so prototype keys and new values cannot resolve to anything but the
 * `unknown` default. Pass the element's `lastCheckedAt` so an unknown that
 * was checked reads "Not confirmed" instead of "Not checked yet".
 */
export function elementStateMeta(raw: unknown, lastCheckedAt?: string | null): ElementStateMeta {
  const meta = baseStateMeta(raw)
  return meta.state === 'unknown' && lastCheckedAt ? UNCONFIRMED : meta
}

function baseStateMeta(raw: unknown): ElementStateMeta {
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
  { id: 'build', label: 'Build', hint: 'Automated checks and CI builds' },
  { id: 'deploy', label: 'Deploy', hint: 'What is live, and where' },
  { id: 'runtime', label: 'Runtime', hint: 'Environment variables and connected tools' },
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

/**
 * What produces each card's state, in one line, so "Needs attention" always
 * says which check said so and when it runs (the times are the pg_cron
 * schedules in the migrations).
 */
export const ELEMENT_CHECKED_BY: Record<RecipeElementKey, string> = {
  schema: 'The schema scanner reads your Supabase schema daily (03:05 UTC) and compares it with the previous read.',
  design: 'The design scan reads your repo daily (03:35 UTC) and compares its styles with the tokens in mushi.recipe.json.',
  routes: 'The app map and its route checks, run with "Run audit" on the Full-stack audit page.',
  gates: 'Every automated check of the full-stack audit, each on its own schedule.',
  ci: 'Your latest GitHub Actions run on the default branch, read live.',
  deploy: 'Probes of the deploy targets declared in mushi.recipe.json.',
  env: 'The env var names set in your GitHub repo (names only), read live.',
  integrations: 'A health check of each connected tool, every 15 minutes.',
}

const FALLBACK_LABEL: Record<RecipeElementKey, string> = {
  schema: 'Database schema',
  design: 'Design system',
  routes: 'Pages and user flows',
  gates: 'Automated checks',
  ci: 'CI builds',
  deploy: 'What is live',
  env: 'Environment variables',
  integrations: 'Connected tools',
}

const NOT_CHECKED_REASON = 'Not checked yet, so this is not a pass.'

/**
 * The 8 elements in canonical lane order. A key the server left out renders
 * as an `unknown` placeholder card instead of disappearing (or turning green).
 * Every view (cards, list, header, diagram edges) reads elements through
 * here, so this is where "OK but never checked" is refused: an `ok` with no
 * check time becomes "Not checked yet" (the server applies the same rule).
 */
export function orderedRecipeElements(
  elements: Partial<Record<RecipeElementKey, RecipeElementSummary>> | null | undefined,
): RecipeElementSummary[] {
  return RECIPE_ELEMENT_KEYS.map((key) => {
    const found = elements?.[key]
    if (found) {
      return found.state === 'ok' && !found.lastCheckedAt ? { ...found, state: 'unknown' as const, reason: NOT_CHECKED_REASON } : found
    }
    return {
      key,
      label: FALLBACK_LABEL[key],
      lane: ELEMENT_LANE[key],
      state: 'unknown',
      reason: 'Mushi could not load this part of the recipe. Press Refresh to try again.',
      lastCheckedAt: null,
      facts: {},
      findingsCount: 0,
      links: [],
    }
  })
}

/**
 * "Checked 3 hours ago" / "Not checked yet". A null or unparseable stamp is
 * never the epoch. With no stamp, the words follow the element's state, so a
 * card never says "Check failed · Not checked yet" or "Needs attention · Not
 * checked yet".
 */
export function describeLastChecked(
  iso: string | null | undefined,
  formatRelative: (d: Date) => string,
  state?: unknown,
): { text: string; title: string | undefined } {
  if (!iso) {
    switch (state === undefined ? 'unknown' : elementStateMeta(state).state) {
      case 'error':
        return { text: 'Last check did not finish', title: undefined }
      case 'drift':
        return { text: 'Check time not recorded', title: undefined }
      case 'not_connected':
        return { text: 'Nothing to check until it is set up', title: undefined }
      default:
        return { text: 'Not checked yet', title: undefined }
    }
  }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { text: 'Check time unknown', title: iso }
  return { text: `Checked ${formatRelative(d)}`, title: d.toLocaleString() }
}

/** "2 problems to fix" / "Nothing open to fix": zero only means "nothing" for an element that was actually judged. */
export function problemCountText(state: ElementState, findings: number): string {
  if (findings > 0) return `${findings.toLocaleString()} problem${findings === 1 ? '' : 's'} to fix`
  return state === 'ok' || state === 'drift' ? 'Nothing open to fix' : 'Not checked for problems'
}

/**
 * The elements the header names next to the overall chip: those in the worst
 * state. None when the worst is OK or merely "not set up" (every element is
 * optional), so the header never names a non-problem.
 */
export function elementsBehindWorst(elements: readonly RecipeElementSummary[]): RecipeElementSummary[] {
  const worst = worstState(elements.map((e) => e.state))
  if (worst === 'ok' || worst === 'not_connected') return []
  return elements.filter((e) => elementStateMeta(e.state).state === worst)
}

/** Card fact value → short display string. */
export function formatFactValue(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return Number.isFinite(v) ? v.toLocaleString() : String(v)
  return v
}

/** Plain labels for the fact keys the server sends; the keys themselves stay as they are. */
const FACT_LABEL: Readonly<Record<string, string>> = {
  linked: 'Supabase linked',
  set: 'Token set',
  tokens: 'Design tokens',
  deviance: 'Off-system score',
  manifest: 'Recipe file',
  graphNodes: 'Pages known',
  inventory: 'inventory.yaml',
  validationErrors: 'File errors',
  gates: 'Checks that ran',
  cadenceDays: 'Expected every (days)',
  bundleKb: 'Web bundle (KB)',
  branch: 'Branch',
  conclusion: 'Last result',
  releases: 'Releases',
  latestRelease: 'Latest release',
  versionsSeen: 'App versions seen',
  required: 'Required',
  missing: 'Missing',
  connected: 'Connected',
}

/** A fact key as a label: the plain label when there is one, else the humanised key. */
export function factLabel(key: string): string {
  return Object.prototype.hasOwnProperty.call(FACT_LABEL, key) ? FACT_LABEL[key] : humanizeKey(key)
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
