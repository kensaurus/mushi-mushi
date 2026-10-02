/**
 * FILE: packages/server/supabase/functions/_shared/recipe-state.ts
 * PURPOSE: The single pure function that turns what Mushi observed about one
 *          recipe element into one of five states (Plan 019 decision 4).
 *
 * The rule this file exists to enforce: "never checked" is never `ok`.
 * No snapshot, a probe that never ran, and data older than its cadence are
 * all `unknown`, with a reason a person can act on. `not_connected` means
 * nothing is configured. Every branch is unit-tested
 * (packages/server/src/__tests__/recipe-state.test.ts).
 */

import type { DevianceRunStatus, ElementState, RecipeElementKey } from './recipe-types.ts'

export interface StateResult {
  state: ElementState
  reason: string
}

export const DAY_MS = 24 * 60 * 60 * 1000

/** Older than `days` (or unparseable) relative to `now`. */
export function isStale(at: string | null, now: Date, days: number): boolean {
  if (!at) return true
  const t = Date.parse(at)
  if (!Number.isFinite(t)) return true
  return now.getTime() - t > days * DAY_MS
}

/** ISO-8601 day durations (`P1D`, `P7D`) → days; anything else → fallback. */
export function cadenceDays(iso: string | undefined | null, fallback: number): number {
  const m = /^P(\d{1,3})D$/i.exec(iso ?? '')
  return m ? Math.max(1, Number(m[1])) : fallback
}

export type ElementInput =
  | {
      key: 'schema'
      linked: boolean
      latestSnapshotAt: string | null
      openDriftFindings: number
      lastRunStatus: string | null
    }
  | {
      key: 'design'
      repoConnected: boolean
      tokenAvailable: boolean
      snapshotAt: string | null
      /** null when no snapshot exists yet. */
      manifestPresent: boolean | null
      manifestErrors: number
      tokenCount: number
      lastError: { at: string; message: string } | null
      runAt: string | null
      runStatus: DevianceRunStatus | null
      /** Open warn + error findings in the latest completed run. */
      openFindings: number
      score: number | null
    }
  | {
      key: 'routes'
      hasInventory: boolean
      graphNodes: number
      validationErrors: number
      lastGateRunAt: string | null
      openFindings: number
    }
  | {
      key: 'gates'
      runs: Array<{ gate: string; status: string; completedAt: string | null; openFindings: number }>
      cadenceDays: number
    }
  | {
      key: 'ci'
      repoConnected: boolean
      tokenAvailable: boolean
      fetchError: string | null
      run: { status: string | null; conclusion: string | null; updatedAt: string | null; name: string | null } | null
    }
  | {
      key: 'deploy'
      releaseCount: number
      appVersions: string[]
    }
  | {
      key: 'env'
      repoConnected: boolean
      tokenAvailable: boolean
      fetchError: string | null
      required: string[]
      missing: string[] | null
    }
  | {
      key: 'integrations'
      configured: Array<{ kind: string; health: string | null; checkedAt: string | null }>
    }

const STALE_DAYS = { schema: 2, design: 7, routes: 14 } as const

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function deriveElementState(input: ElementInput, now: Date = new Date()): StateResult {
  switch (input.key) {
    case 'schema': {
      if (!input.linked && !input.latestSnapshotAt) {
        return { state: 'not_connected', reason: 'Link your Supabase project so Mushi can snapshot the schema.' }
      }
      if (!input.latestSnapshotAt) return { state: 'unknown', reason: 'Linked, but the schema has never been scanned.' }
      if (input.lastRunStatus === 'error') return { state: 'error', reason: 'The last schema scan failed.' }
      if (isStale(input.latestSnapshotAt, now, STALE_DAYS.schema)) {
        return { state: 'unknown', reason: 'The last schema snapshot is older than two days.' }
      }
      if (input.openDriftFindings > 0) return { state: 'drift', reason: `${plural(input.openDriftFindings, 'schema change')} to review.` }
      return { state: 'ok', reason: 'Schema matches the last snapshot.' }
    }

    case 'design': {
      if (!input.repoConnected) return { state: 'not_connected', reason: 'Connect a GitHub repo so Mushi can read mushi.recipe.json and your token files.' }
      if (!input.tokenAvailable) return { state: 'not_connected', reason: 'No GitHub token for this project, so the repo cannot be read.' }
      const errorNewer = input.lastError && (!input.snapshotAt || Date.parse(input.lastError.at) > Date.parse(input.snapshotAt))
      if (!input.snapshotAt) {
        return errorNewer
          ? { state: 'error', reason: `Reading the design system failed: ${input.lastError!.message}` }
          : { state: 'unknown', reason: 'Tokens have never been read. Refresh to ingest them.' }
      }
      if (input.manifestPresent === false) {
        return input.manifestErrors > 0
          ? { state: 'error', reason: 'mushi.recipe.json was rejected; see its validation errors.' }
          : { state: 'not_connected', reason: 'No mushi.recipe.json at the repo root. Add one that lists your DTCG token files.' }
      }
      if (input.tokenCount === 0) return { state: 'not_connected', reason: 'mushi.recipe.json lists no readable design tokens.' }
      if (errorNewer) return { state: 'error', reason: `The last refresh or scan failed: ${input.lastError!.message}` }
      if (!input.runAt || !input.runStatus) return { state: 'unknown', reason: 'Tokens are in, but the deviance check has never run.' }
      if (input.runStatus === 'running') return { state: 'unknown', reason: 'A deviance check is running.' }
      if (input.runStatus === 'error') return { state: 'error', reason: 'The last deviance check failed.' }
      if (isStale(input.runAt, now, STALE_DAYS.design)) return { state: 'unknown', reason: 'The last deviance check is older than a week.' }
      if (input.score == null) return { state: 'unknown', reason: 'The last deviance check could not score anything.' }
      if (input.openFindings > 0) {
        return { state: 'drift', reason: `Deviance ${input.score}/100 with ${plural(input.openFindings, 'off-system value')} to fix.` }
      }
      return { state: 'ok', reason: `Deviance ${input.score}/100; nothing above info level.` }
    }

    case 'routes': {
      if (!input.hasInventory && input.graphNodes === 0) {
        return { state: 'not_connected', reason: 'No inventory.yaml and no routes observed by the SDK yet.' }
      }
      if (input.validationErrors > 0) return { state: 'drift', reason: `inventory.yaml has ${plural(input.validationErrors, 'validation error')}.` }
      if (!input.lastGateRunAt) return { state: 'unknown', reason: 'Routes are known, but no inventory gate has checked them.' }
      if (isStale(input.lastGateRunAt, now, STALE_DAYS.routes)) return { state: 'unknown', reason: 'The last inventory gate run is older than two weeks.' }
      if (input.openFindings > 0) return { state: 'drift', reason: `${plural(input.openFindings, 'open route finding')}.` }
      return { state: 'ok', reason: 'Declared routes match what the gates observed.' }
    }

    case 'gates': {
      if (input.runs.length === 0) return { state: 'not_connected', reason: 'No gate has run for this project.' }
      const errored = input.runs.filter((r) => r.status === 'error')
      if (errored.length > 0) return { state: 'error', reason: `The last ${errored.map((r) => r.gate).join(', ')} run failed to complete.` }
      const stale = input.runs.filter((r) => isStale(r.completedAt, now, input.cadenceDays))
      const open = input.runs.reduce((n, r) => n + r.openFindings, 0)
      if (open > 0) return { state: 'drift', reason: `${plural(open, 'open finding')} across the latest gate runs.` }
      if (stale.length === input.runs.length) return { state: 'unknown', reason: `No gate has run in the last ${plural(input.cadenceDays, 'day')}.` }
      if (stale.length > 0) return { state: 'unknown', reason: `${stale.map((r) => r.gate).join(', ')} ${stale.length === 1 ? 'has' : 'have'} not run in ${plural(input.cadenceDays, 'day')}.` }
      return { state: 'ok', reason: 'Every gate passed on its latest run.' }
    }

    case 'ci': {
      if (!input.repoConnected) return { state: 'not_connected', reason: 'Connect a GitHub repo to see CI on the default branch.' }
      if (!input.tokenAvailable) return { state: 'not_connected', reason: 'No GitHub token for this project, so CI runs cannot be read.' }
      if (input.fetchError) return { state: 'error', reason: `Could not read CI runs: ${input.fetchError}` }
      if (!input.run) return { state: 'unknown', reason: 'No workflow run found for the latest default-branch commit.' }
      if (input.run.status !== 'completed') return { state: 'unknown', reason: `CI is ${input.run.status ?? 'in an unknown state'} on the latest commit.` }
      if (input.run.conclusion === 'success') return { state: 'ok', reason: 'CI passed on the latest default-branch commit.' }
      if (input.run.conclusion === 'skipped' || input.run.conclusion === 'neutral') {
        return { state: 'unknown', reason: `CI was ${input.run.conclusion} on the latest commit.` }
      }
      return { state: 'drift', reason: `CI ${input.run.conclusion ?? 'did not succeed'} on the latest default-branch commit.` }
    }

    case 'deploy': {
      if (input.releaseCount === 0 && input.appVersions.length === 0) {
        return { state: 'not_connected', reason: 'No deploy target declared and no app versions seen yet.' }
      }
      return { state: 'unknown', reason: 'No deploy signal yet; showing releases and the app versions users report.' }
    }

    case 'env': {
      if (!input.repoConnected) return { state: 'not_connected', reason: 'Connect a GitHub repo to check which env names CI has.' }
      if (!input.tokenAvailable) return { state: 'not_connected', reason: 'No GitHub token for this project, so CI env names cannot be listed.' }
      if (input.fetchError) return { state: 'error', reason: `Could not list CI secrets and variables: ${input.fetchError}` }
      if (input.missing == null) return { state: 'unknown', reason: 'CI env names have not been listed.' }
      if (input.missing.length > 0) return { state: 'drift', reason: `Missing from CI: ${input.missing.join(', ')}.` }
      return { state: 'ok', reason: `All ${plural(input.required.length, 'required Mushi variable')} exist in CI.` }
    }

    case 'integrations': {
      if (input.configured.length === 0) return { state: 'not_connected', reason: 'No integrations connected. Every one is optional.' }
      const down = input.configured.filter((c) => c.health === 'down' || c.health === 'degraded')
      if (down.length > 0) return { state: 'drift', reason: `${down.map((c) => `${c.kind} is ${c.health}`).join('; ')}.` }
      const unchecked = input.configured.filter((c) => !c.health || c.health === 'unknown')
      if (unchecked.length > 0) return { state: 'unknown', reason: `${unchecked.map((c) => c.kind).join(', ')} ${unchecked.length === 1 ? 'has' : 'have'} never been health-checked.` }
      return { state: 'ok', reason: `${plural(input.configured.length, 'integration')} healthy.` }
    }
  }
}

const STATE_RANK: Record<ElementState, number> = { error: 0, drift: 1, unknown: 2, not_connected: 3, ok: 4 }

/** The worst of several states. An empty list is `unknown`, never `ok`. */
export function worstState(states: readonly ElementState[]): ElementState {
  if (states.length === 0) return 'unknown'
  return states.reduce((w, s) => (STATE_RANK[s] < STATE_RANK[w] ? s : w))
}

export const ELEMENT_META: Readonly<Record<RecipeElementKey, { label: string; lane: 'sources' | 'build' | 'deploy' | 'runtime' }>> = {
  schema: { label: 'Schema', lane: 'sources' },
  design: { label: 'Design system', lane: 'sources' },
  routes: { label: 'Routes & stories', lane: 'sources' },
  gates: { label: 'Gates', lane: 'build' },
  ci: { label: 'CI/CD', lane: 'build' },
  deploy: { label: 'Deploy', lane: 'deploy' },
  env: { label: 'Env names', lane: 'runtime' },
  integrations: { label: 'Integrations', lane: 'runtime' },
}
