/**
 * FILE: packages/server/supabase/functions/_shared/funnel-steps.ts
 * PURPOSE: The new-user path's server steps (docs/plan-simplicity-2026-10.md
 *          Phase 0), each written once per project into the company funnel:
 *
 *   sdk_seen_localhost      first SDK check-in from a dev machine      (auth.ts heartbeat)
 *   sdk_seen_live           first from a live site or a store app       (auth.ts heartbeat)
 *   first_real_report       first end-user report from a deployed app   (api/helpers.ts ingest)
 *   first_diagnosis_viewed  first diagnosis a person saw in the console (setup-funnel route)
 *   first_fix_dispatched    first fix dispatch                          (dispatch.ts, fix-dispatch route)
 *   first_fix_merged        first merged fix PR                         (fix-merge.ts finalizeFixMerge)
 *
 * "Once" has two layers:
 *   - the product_events unique (project_id, dedup_key) with dedup key
 *     '<step>:<host project id>' (every server event lands in the self
 *     project, so the host project must be in the key) — the real guarantee
 *     across isolates and retries;
 *   - a per-isolate memo, so a hot path asks the database at most once per
 *     project and step.
 * Before emitting, each caller checks that the project had no earlier
 * occurrence (an earlier dispatch, merge, origin of that kind, …). Without
 * that, an existing app would be stamped "first" at its next occurrence
 * after this shipped — the backdating first-report.ts describes. For
 * sdk_seen_* that history is the migration's backfill of each key's one
 * stored origin, so it is best effort.
 *
 * Every step has an actor: the person who did it when known, else the
 * project's owner (emitProductEvent actorFallback).
 *
 * The decision helpers are pure. product-events.ts is imported only when a
 * step is written: it reads its env at module load, and this module sits on
 * the ingest and dispatch paths (and in their unit tests).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { keepAlive } from './background.ts'
import { log } from './logger.ts'

export const FUNNEL_STEPS = [
  'sdk_seen_localhost',
  'sdk_seen_live',
  'first_real_report',
  'first_diagnosis_viewed',
  'first_fix_dispatched',
  'first_fix_merged',
] as const
export type FunnelStep = (typeof FUNNEL_STEPS)[number]

/** product_events dedup key: one row per step and host project, ever. */
export function funnelStepDedupKey(step: FunnelStep, projectId: string): string {
  return `${step}:${projectId}`
}

/**
 * Per-isolate memo of (step, project) pairs this isolate already settled,
 * emitted or found not to be first. Bounded: when full it starts over, which
 * costs one extra lookup per project, never a duplicate row.
 */
export class FunnelStepMemo {
  private readonly done = new Set<string>()

  constructor(private readonly maxEntries = 5000) {}

  /** True the first time (step, project) is claimed in this isolate. */
  claim(step: FunnelStep, projectId: string): boolean {
    const id = funnelStepDedupKey(step, projectId)
    if (this.done.has(id)) return false
    if (this.done.size >= this.maxEntries) this.done.clear()
    this.done.add(id)
    return true
  }

  /** Release a claim whose check failed, so a later call tries again. */
  release(step: FunnelStep, projectId: string): void {
    this.done.delete(funnelStepDedupKey(step, projectId))
  }
}

export type FirstStepDecision = 'emit' | 'not_first' | 'unknown'

/**
 * Whether this occurrence is the project's first: `earlier` is how many
 * other occurrences the project already has (dispatches, merges, …), or null
 * when the read failed. A failed read emits nothing and is retried later; a
 * wrong "first" cannot be taken back, a late one can still be recorded.
 */
export function decideFirstStep(earlier: number | null | undefined): FirstStepDecision {
  if (earlier === null || earlier === undefined || !Number.isFinite(earlier)) return 'unknown'
  return earlier > 0 ? 'not_first' : 'emit'
}

/**
 * How old a setup_funnel_events `diagnosis_viewed` row must be to mean "seen
 * before this request". The route writes that row in the same request, so a
 * row created moments ago is this view's own.
 */
export const EARLIER_SETUP_STEP_MS = 5 * 60_000

/** True when the project's setup step was written before this view (not by it). */
export function setupStepWasEarlier(createdAt: string | null | undefined, nowMs: number): boolean {
  if (!createdAt) return false
  const at = Date.parse(createdAt)
  return Number.isFinite(at) && nowMs - at > EARLIER_SETUP_STEP_MS
}

/** One memo per isolate, shared by every step and caller. */
export const funnelStepMemo = new FunnelStepMemo()

export interface FunnelStepEmit {
  step: FunnelStep
  projectId: string
  /** The person who did it, when known; else the project's owner is the actor. */
  actorUserId?: string | null
  properties?: Record<string, string | number | boolean | null>
}

/** Write the step's product event. Never throws (emitProductEvent logs failures). */
export async function emitFunnelStep(db: SupabaseClient, input: FunnelStepEmit): Promise<boolean> {
  try {
    const { emitProductEvent } = await import('./product-events.ts')
    return await emitProductEvent(db, {
      userId: input.actorUserId ?? null,
      actorFallback: 'project_owner',
      eventName: input.step,
      surface: 'server',
      properties: { ...(input.properties ?? {}), project_id: input.projectId },
      dedupKey: funnelStepDedupKey(input.step, input.projectId),
    })
  } catch (err) {
    log.warn('funnel-steps: emit failed', { step: input.step, projectId: input.projectId, err: err instanceof Error ? err.message : String(err) })
    return false
  }
}

/**
 * `first_fix_dispatched`, after a fix_dispatch_jobs row was inserted. Only
 * when the project has no other dispatch and no fix attempt (a local worker
 * opens attempts without a dispatch row), so an app with a fix history is not
 * stamped "first". Detached and never throws.
 *
 * Called by the two dispatch inserts outside fix-worker: _shared/dispatch.ts
 * (Slack, Linear agent, spend-down, library-modernizer) and
 * POST /v1/admin/fixes/dispatch (console, CLI, MCP).
 */
export function emitFirstFixDispatched(
  db: SupabaseClient,
  input: { projectId: string; reportId: string; dispatchId: string; actorUserId?: string | null },
): void {
  const { projectId } = input
  if (!funnelStepMemo.claim('first_fix_dispatched', projectId)) return
  void keepAlive((async () => {
    const [jobs, attempts] = await Promise.all([
      db.from('fix_dispatch_jobs').select('id', { count: 'exact', head: true })
        .eq('project_id', projectId).neq('id', input.dispatchId),
      db.from('fix_attempts').select('id', { count: 'exact', head: true })
        .eq('project_id', projectId),
    ])
    const earlier = jobs.error || attempts.error ? null : (jobs.count ?? 0) + (attempts.count ?? 0)
    const decision = decideFirstStep(earlier)
    if (decision === 'unknown') {
      funnelStepMemo.release('first_fix_dispatched', projectId)
      log.warn('first_fix_dispatched: earlier-dispatch lookup failed; step not recorded yet', {
        projectId,
        err: jobs.error?.message ?? attempts.error?.message ?? 'no count',
      })
      return
    }
    if (decision === 'not_first') return
    await emitFunnelStep(db, {
      step: 'first_fix_dispatched',
      projectId,
      actorUserId: input.actorUserId ?? null,
      properties: { report_id: input.reportId },
    })
  })().catch((err: unknown) => {
    funnelStepMemo.release('first_fix_dispatched', projectId)
    log.warn('first_fix_dispatched emit failed', { projectId, err: err instanceof Error ? err.message : String(err) })
  }))
}
