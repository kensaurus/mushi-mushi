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
import { GATE_MEANINGS } from './finding-explain.ts'

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
      /** Open ci_drift findings from the connector collector (Phase 2); undefined = not collected. */
      driftFindings?: number
    }
  | {
      key: 'deploy'
      releaseCount: number
      appVersions: string[]
      /** Phase 2: declared deploy targets and their latest observation each. */
      targetsDeclared?: number
      observations?: Array<{ targetId: string; ok: boolean; observedAt: string; error: string | null }>
      /** Open deploy_drift findings (not_deployed, platform_skew…). */
      driftFindings?: number
    }
  | {
      key: 'env'
      repoConnected: boolean
      tokenAvailable: boolean
      fetchError: string | null
      required: string[]
      missing: string[] | null
      /** Open env_drift findings from the declared env (Phase 2). */
      driftFindings?: number
    }
  | {
      key: 'integrations'
      configured: Array<{ kind: string; health: string | null; checkedAt: string | null }>
    }

const STALE_DAYS = { schema: 2, design: 7, routes: 14 } as const

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Mushi's own setup checks (rejected key, no spend cap, webhook never delivered, stale index). */
const MUSHI_SETUP_GATE = 'radar'

/** A gate id as people read it ("Mushi setup check", "Code health"); the id itself when unknown. */
export function gateLabel(gate: string): string {
  return Object.prototype.hasOwnProperty.call(GATE_MEANINGS, gate) ? GATE_MEANINGS[gate].label : gate
}

function joinGates(gates: readonly string[]): string {
  return gates.map(gateLabel).join(', ')
}

/**
 * Applied last, on the server and again in the console: an element that says
 * `ok` with no check time was never checked, so it is `unknown` ("Not checked
 * yet"), never a pass. Keeps the chip and the "Checked ..." line from
 * contradicting each other.
 */
export function guardNeverChecked(st: StateResult, lastCheckedAt: string | null): StateResult {
  if (st.state === 'ok' && !lastCheckedAt) return { state: 'unknown', reason: 'Not checked yet, so this is not a pass.' }
  return st
}

export function deriveElementState(input: ElementInput, now: Date = new Date()): StateResult {
  switch (input.key) {
    case 'schema': {
      if (!input.linked && !input.latestSnapshotAt) {
        return { state: 'not_connected', reason: 'Not set up. Link your Supabase project in Settings so Mushi can read the database schema.' }
      }
      if (!input.latestSnapshotAt) return { state: 'unknown', reason: 'Not checked yet. The schema scan runs once a day; if it never runs, check your Supabase link in Settings.' }
      if (input.lastRunStatus === 'error') return { state: 'error', reason: 'The last schema scan failed. It runs again once a day; check your Supabase link in Settings.' }
      if (isStale(input.latestSnapshotAt, now, STALE_DAYS.schema)) {
        return { state: 'unknown', reason: 'The last schema scan is more than two days old. It should run daily; check your Supabase link in Settings.' }
      }
      if (input.openDriftFindings > 0) return { state: 'drift', reason: `${plural(input.openDriftFindings, 'database change')} since the last scan to review on the Schema changes page.` }
      return { state: 'ok', reason: 'The database matches the last scan.' }
    }

    case 'design': {
      if (!input.repoConnected) return { state: 'not_connected', reason: 'Not set up. Connect a GitHub repo in Settings so Mushi can read your design token files.' }
      if (!input.tokenAvailable) return { state: 'not_connected', reason: 'Mushi has no GitHub access for this project, so it cannot read the repo. Reconnect GitHub in Settings.' }
      const errorNewer = input.lastError && (!input.snapshotAt || Date.parse(input.lastError.at) > Date.parse(input.snapshotAt))
      if (!input.snapshotAt) {
        return errorNewer
          ? { state: 'error', reason: `Mushi could not read your design system: ${input.lastError!.message} Press Refresh to try again.` }
          : { state: 'unknown', reason: 'Your design tokens have not been read yet. Press Refresh to read them.' }
      }
      if (input.manifestPresent === false) {
        return input.manifestErrors > 0
          ? { state: 'error', reason: 'Your mushi.recipe.json file has errors, so its design tokens were not read. Fix them, then press Refresh.' }
          : { state: 'not_connected', reason: 'Not set up. Add a file named mushi.recipe.json at your repo root that lists your design token files.' }
      }
      if (input.tokenCount === 0) return { state: 'not_connected', reason: 'Your recipe file lists no design token files Mushi can read. Add their paths to mushi.recipe.json.' }
      if (errorNewer) return { state: 'error', reason: `The last design check failed: ${input.lastError!.message} Press Refresh to try again.` }
      if (!input.runAt || !input.runStatus) return { state: 'unknown', reason: 'Design tokens are read, but the design check has not run yet. Run it from the Design system page.' }
      if (input.runStatus === 'running') return { state: 'unknown', reason: 'A design check is running now.' }
      if (input.runStatus === 'error') return { state: 'error', reason: 'The last design check failed. Run it again from the Design system page.' }
      if (isStale(input.runAt, now, STALE_DAYS.design)) return { state: 'unknown', reason: 'The last design check is more than a week old. Run it again from the Design system page.' }
      if (input.score == null) return { state: 'unknown', reason: 'The last design check found no code to score.' }
      if (input.openFindings > 0) {
        return { state: 'drift', reason: `${plural(input.openFindings, 'hard-coded style')} to swap for your design tokens (off-system score ${input.score}/100). Open the Design system page for each one.` }
      }
      return { state: 'ok', reason: `Code follows your design tokens (off-system score ${input.score}/100).` }
    }

    case 'routes': {
      if (!input.hasInventory && input.graphNodes === 0) {
        return { state: 'not_connected', reason: 'Not set up. Install the Mushi SDK in your app, or add an inventory.yaml, so Mushi learns your pages.' }
      }
      if (input.validationErrors > 0) return { state: 'drift', reason: `Your inventory.yaml has ${plural(input.validationErrors, 'error')}. Fix them on the Inventory page.` }
      if (!input.lastGateRunAt) return { state: 'unknown', reason: 'Not checked yet. Mushi knows your pages, but no check has tested them. Run the checks from the Inventory page.' }
      if (isStale(input.lastGateRunAt, now, STALE_DAYS.routes)) return { state: 'unknown', reason: 'The last page check is more than two weeks old. Run the checks again from the Inventory page.' }
      if (input.openFindings > 0) return { state: 'drift', reason: `${plural(input.openFindings, 'page problem')} to fix. Open the Inventory page for each one.` }
      return { state: 'ok', reason: 'Your pages work the way the checks expect.' }
    }

    case 'gates': {
      if (input.runs.length === 0) return { state: 'not_connected', reason: 'Not set up. No automated check has run for this app yet.' }
      const errored = input.runs.filter((r) => r.status === 'error')
      if (errored.length > 0) return { state: 'error', reason: `The last run of ${joinGates(errored.map((r) => r.gate))} did not finish. Run it again from Code health.` }
      const stale = input.runs.filter((r) => isStale(r.completedAt, now, input.cadenceDays))
      const open = input.runs.reduce((n, r) => n + r.openFindings, 0)
      if (open > 0) {
        const openRuns = input.runs.filter((r) => r.openFindings > 0)
        const withOpen = openRuns.map((r) => `${gateLabel(r.gate)} (${r.openFindings})`)
        // Mushi's own setup checks are fixed from the Risk checks section (one-click caps), not from an audit list.
        const setup = openRuns.some((r) => r.gate === MUSHI_SETUP_GATE)
        const others = openRuns.some((r) => r.gate !== MUSHI_SETUP_GATE)
        const where = setup && others
          ? 'Mushi setup checks and their fixes are under Risk checks on the Recipe page; the rest are in Full-stack audit.'
          : setup
            ? 'They and their fixes are under Risk checks on the Recipe page.'
            : 'Open Full-stack audit for each one and its fix.'
        return { state: 'drift', reason: `${plural(open, 'problem')} to fix: ${withOpen.join(', ')}. ${where}` }
      }
      if (stale.length === input.runs.length) return { state: 'unknown', reason: `No automated check has run in the last ${plural(input.cadenceDays, 'day')}.` }
      if (stale.length > 0) return { state: 'unknown', reason: `${joinGates(stale.map((r) => r.gate))} ${stale.length === 1 ? 'has' : 'have'} not run in ${plural(input.cadenceDays, 'day')}.` }
      return { state: 'ok', reason: 'Every automated check passed on its latest run.' }
    }

    case 'ci': {
      if (!input.repoConnected) return { state: 'not_connected', reason: 'Not set up. Connect a GitHub repo in Settings to see your CI builds.' }
      if (!input.tokenAvailable) return { state: 'not_connected', reason: 'Mushi has no GitHub access for this project, so it cannot read CI. Reconnect GitHub in Settings.' }
      if (input.fetchError) return { state: 'error', reason: `Mushi could not read your CI builds: ${input.fetchError}` }
      if (!input.run) return { state: 'unknown', reason: 'No CI build ran for your latest commit on the main branch.' }
      if (input.run.status !== 'completed') return { state: 'unknown', reason: `CI is ${input.run.status ?? 'in an unknown state'} on the latest commit.` }
      if (input.run.conclusion === 'success') {
        if (input.driftFindings && input.driftFindings > 0) return { state: 'drift', reason: `CI passed, but ${plural(input.driftFindings, 'workflow setting')} to fix (timeouts, concurrency, cost). Open each one for its fix.` }
        return { state: 'ok', reason: 'CI passed on your latest commit.' }
      }
      if (input.run.conclusion === 'skipped' || input.run.conclusion === 'neutral') {
        return { state: 'unknown', reason: `CI was ${input.run.conclusion} on the latest commit.` }
      }
      return { state: 'drift', reason: `CI ${input.run.conclusion ?? 'did not succeed'} on your latest commit. Open the workflow run to see why.` }
    }

    case 'deploy': {
      if (input.targetsDeclared && input.targetsDeclared > 0) {
        const obs = input.observations ?? []
        if (obs.length === 0) return { state: 'unknown', reason: `Not checked yet. ${plural(input.targetsDeclared, 'deploy target')} declared; Mushi checks them once a day.` }
        const failed = obs.filter((o) => !o.ok)
        if (failed.length > 0) return { state: 'error', reason: `The probe of ${failed.map((o) => o.targetId).join(', ')} failed${failed[0].error ? `: ${failed[0].error}` : ''}.` }
        if (obs.every((o) => isStale(o.observedAt, now, 2))) return { state: 'unknown', reason: 'No deploy target has been probed in two days.' }
        if (input.driftFindings && input.driftFindings > 0) return { state: 'drift', reason: `${plural(input.driftFindings, 'deploy problem')}: a fix may be merged but not live yet. Deploy your latest commit; Mushi checks again within a day.` }
        if (obs.length < input.targetsDeclared) return { state: 'unknown', reason: `${obs.length} of ${plural(input.targetsDeclared, 'target')} observed; the rest have no signal yet.` }
        return { state: 'ok', reason: 'Every observed target runs what the default branch has.' }
      }
      if (input.releaseCount === 0 && input.appVersions.length === 0) {
        return { state: 'not_connected', reason: 'Not set up. Add deploy targets to mushi.recipe.json so Mushi can check what is live.' }
      }
      return { state: 'unknown', reason: 'Not checked. No deploy target is declared, so Mushi only shows releases and the app versions users report. Add deploy targets to mushi.recipe.json.' }
    }

    case 'env': {
      if (!input.repoConnected) return { state: 'not_connected', reason: 'Not set up. Connect a GitHub repo in Settings so Mushi can check your environment variables.' }
      if (!input.tokenAvailable) return { state: 'not_connected', reason: 'Mushi has no GitHub access for this project, so it cannot list your environment variables. Reconnect GitHub in Settings.' }
      if (input.fetchError) return { state: 'error', reason: `Mushi could not list your GitHub secrets and variables: ${input.fetchError}` }
      if (input.missing == null) return { state: 'unknown', reason: 'Not checked yet. Press Refresh to list your GitHub secrets and variables.' }
      if (input.missing.length > 0) return { state: 'drift', reason: `Missing from GitHub: ${input.missing.join(', ')}. Add them as GitHub Actions secrets or variables.` }
      if (input.driftFindings && input.driftFindings > 0) return { state: 'drift', reason: `${plural(input.driftFindings, 'environment variable')} missing where your app runs. Open each one for its fix.` }
      return { state: 'ok', reason: `All ${plural(input.required.length, 'required variable')} are set in GitHub.` }
    }

    case 'integrations': {
      if (input.configured.length === 0) return { state: 'not_connected', reason: 'Not set up. No tools connected yet; every one is optional.' }
      const down = input.configured.filter((c) => c.health === 'down' || c.health === 'degraded')
      if (down.length > 0) return { state: 'drift', reason: `${down.map((c) => `${c.kind} is ${c.health}`).join('; ')}. Open Integrations to reconnect it.` }
      // Never checked (no health row) and checked-but-inconclusive are different facts.
      const never = input.configured.filter((c) => !c.checkedAt)
      if (never.length > 0) return { state: 'unknown', reason: `Not checked yet: ${never.map((c) => c.kind).join(', ')}. Run a check from Integrations.` }
      const unclear = input.configured.filter((c) => !c.health || c.health === 'unknown')
      if (unclear.length > 0) return { state: 'unknown', reason: `The last check of ${unclear.map((c) => c.kind).join(', ')} could not tell if ${unclear.length === 1 ? 'it works' : 'they work'}. Run the check again from Integrations.` }
      return { state: 'ok', reason: `${plural(input.configured.length, 'connected tool')} working.` }
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
  schema: { label: 'Database schema', lane: 'sources' },
  design: { label: 'Design system', lane: 'sources' },
  routes: { label: 'Pages and user flows', lane: 'sources' },
  gates: { label: 'Automated checks', lane: 'build' },
  ci: { label: 'CI builds', lane: 'build' },
  deploy: { label: 'What is live', lane: 'deploy' },
  env: { label: 'Environment variables', lane: 'runtime' },
  integrations: { label: 'Connected tools', lane: 'runtime' },
}
