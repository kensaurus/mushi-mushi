/**
 * FILE: packages/server/supabase/functions/_shared/ci-placement-timebox.ts
 * PURPOSE: Switch a time-boxed CI placement change back when it is due
 *          (ADR 0037 amendment, 2026-10-30). Runs from the CI collector tick
 *          (every 10 minutes).
 *
 * A move to GitHub-hosted runners can carry `revertAfterHours` in its payload.
 * The person who approved the change approved the time box with it (it is in
 * the hashed payload), so when it is due the revert is filed, approved in
 * their name and run here, with no second approval. It is the same revert as
 * the console's: `revertPayload` puts the previous value back, and act()
 * re-checks the allowlist, the binding, the policy and the compare-and-set.
 * If someone changed the variable since Mushi set it, act() refuses
 * (VARIABLE_MOVED), the revert is recorded as failed and never retried: a
 * person's later choice wins over the timer.
 */

import {
  approveConnectorAction,
  executeConnectorAction,
  requestLegacyConnectorAction,
  type ExecuteDeps,
} from './connector-actions.ts'
import { PLACEMENT_ACTIONS, revertDueAt, revertPayload, type PlacementPayload, type VariableState } from './ci-placement.ts'

// deno-lint-ignore no-explicit-any
type Db = any

/** Changes looked at per tick; due ones are few. */
export const TIMEBOX_SCAN_LIMIT = 50

export interface TimeboxDeps {
  request: typeof requestLegacyConnectorAction
  approve: typeof approveConnectorAction
  execute: typeof executeConnectorAction
  executeDeps: ExecuteDeps
}

export const defaultTimeboxDeps = (executeDeps: ExecuteDeps): TimeboxDeps => ({
  request: requestLegacyConnectorAction,
  approve: approveConnectorAction,
  execute: executeConnectorAction,
  executeDeps,
})

export interface TimeboxSummary {
  due: number
  reverted: number
  failed: number
}

interface ExecutedRow {
  id: string
  organization_id: string
  project_id: string | null
  action: string
  payload: PlacementPayload & { revertOf?: string }
  approved_by: string | null
  executed_at: string | null
  result: { next?: VariableState } | null
}

export async function runTimedReverts(db: Db, now: Date, deps: TimeboxDeps): Promise<TimeboxSummary> {
  const summary: TimeboxSummary = { due: 0, reverted: 0, failed: 0 }
  const { data, error } = await db
    .from('connector_actions')
    .select('id, organization_id, project_id, action, payload, approved_by, executed_at, result')
    .eq('connector_kind', 'github')
    .eq('status', 'executed')
    .in('action', [...PLACEMENT_ACTIONS])
    .not('payload->>revertAfterHours', 'is', null)
    .order('executed_at', { ascending: true })
    .limit(TIMEBOX_SCAN_LIMIT)
  if (error || !Array.isArray(data)) return summary

  for (const row of data as ExecutedRow[]) {
    const due = revertDueAt(row.payload, row.executed_at)
    if (!due || due.getTime() > now.getTime() || !row.project_id || !row.approved_by) continue
    // One revert per change, ever: a pending, done or failed one stops the timer.
    const { data: existing, error: existingErr } = await db
      .from('connector_actions')
      .select('id')
      .eq('organization_id', row.organization_id)
      .eq('payload->>revertOf', row.id)
      .limit(1)
    if (existingErr || (Array.isArray(existing) && existing.length > 0)) continue
    const left = row.result?.next
    if (!left) continue
    summary.due++

    const back = revertPayload(row.payload, left)
    const payload = { ...back, revertOf: row.id, timeBox: true }
    const requested = await deps.request(db, {
      organizationId: row.organization_id,
      projectId: row.project_id,
      kind: 'github',
      action: back.value === null ? 'delete_actions_variable' : 'set_actions_variable',
      payload: payload as unknown as Record<string, unknown>,
      requestedBy: 'system:time_box',
      reason: `Time box of ${row.id}: ${row.payload.revertAfterHours} h on GitHub-hosted runners is up.`,
    })
    if (!requested.ok) {
      summary.failed++
      continue
    }
    const approved = await deps.approve(db, requested.value.id, row.organization_id, row.approved_by, now, requested.value.payloadSha256)
    const ran = approved.ok
      ? await deps.execute(db, requested.value.id, row.organization_id, row.approved_by, deps.executeDeps)
      : null
    if (ran?.ok) {
      summary.reverted++
      await db
        .from('ci_placement_watches')
        .update({ status: 'reverted', revert_action_id: requested.value.id, updated_at: now.toISOString() })
        .eq('action_id', row.id)
    } else {
      summary.failed++
    }
  }
  return summary
}
