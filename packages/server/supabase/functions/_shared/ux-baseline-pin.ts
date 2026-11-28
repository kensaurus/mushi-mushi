/**
 * FILE: packages/server/supabase/functions/_shared/ux-baseline-pin.ts
 * PURPOSE: Pin each screen's current screenshot to a release or version
 *          (ADR 0072). One path for the console's "Pin current screens"
 *          (POST /timeline/baselines) and the opt-in pin on release publish
 *          (`project_settings.ux_baseline_auto_pin`, default off), so both
 *          copy the same captures under the same limits: the newest
 *          PIN_RUNS_READ finished runs, at most UX_BASELINE_PIN_MAX copies,
 *          COPY_CONCURRENCY at a time. No model call.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'
import { UX_CAPTURES_BUCKET } from './ux-runs.ts'
import { baselineCapturePath, pickBaselineCaptures, type CaptureSourceRow } from './ux-timeline.ts'

const plog = log.child('ux-baseline-pin')
/** Runs a pin looks through for each screen's newest capture. */
const PIN_RUNS_READ = 20
const COPY_CONCURRENCY = 6

export type PinOutcome =
  | { ok: true; pinned: number; failed: number; screens: number }
  | { ok: false; code: 'NO_CAPTURES' | 'DB_ERROR'; message: string }

export interface PinInput {
  projectId: string
  version: string
  releaseId: string | null
  /** The person who pinned; null for the automatic pin on publish. */
  userId: string | null
  /** Pin only these screens. */
  only?: ReadonlySet<string>
}

/** Copy each screen's current capture under <project>/baselines/ and upsert its row. */
export async function pinBaselines(db: SupabaseClient, input: PinInput): Promise<PinOutcome> {
  const { projectId, version, releaseId } = input
  const { data: runRows, error: runErr } = await db
    .from('ux_runs')
    .select('id, kind, pr_state')
    .eq('project_id', projectId)
    .in('kind', ['loop', 'scorecard'])
    .in('status', ['done', 'stopped'])
    .order('started_at', { ascending: false })
    .limit(PIN_RUNS_READ)
  if (runErr) return { ok: false, code: 'DB_ERROR', message: runErr.message }
  const runs = (runRows ?? []) as Array<{ id: string; kind: string; pr_state: string | null }>
  if (!runs.length) return { ok: false, code: 'NO_CAPTURES', message: 'No finished UX run or scorecard run to pin yet. Run `mushi-ux scorecard --sync` first.' }
  const { data: surfRows, error: sErr } = await db
    .from('ux_surfaces')
    .select('run_id, surface_key, kind, path, label, status, score, penalty_before, penalty_after, capture_hash, cost_usd, thumbs, facts')
    .in('run_id', runs.map((r) => r.id))
    .limit(5000)
  if (sErr) return { ok: false, code: 'DB_ERROR', message: sErr.message }
  const order = new Map(runs.map((r, i) => [r.id, i]))
  const runById = new Map(runs.map((r) => [r.id, r]))
  const rows: CaptureSourceRow[] = ((surfRows ?? []) as Array<Record<string, unknown>>)
    .filter((s) => runById.has(String(s.run_id)))
    .map((s) => {
      const run = runById.get(String(s.run_id))!
      const facts = (s.facts ?? null) as { viewport?: { width?: number } } | null
      return {
        run_id: String(s.run_id),
        run_kind: run.kind,
        run_pr_merged: run.pr_state === 'merged',
        surface_key: String(s.surface_key),
        kind: String(s.kind),
        path: String(s.path),
        label: String(s.label ?? ''),
        status: String(s.status),
        score: typeof s.score === 'number' ? s.score : null,
        penalty_before: typeof s.penalty_before === 'number' ? s.penalty_before : null,
        penalty_after: typeof s.penalty_after === 'number' ? s.penalty_after : null,
        capture_hash: typeof s.capture_hash === 'string' ? s.capture_hash : null,
        cost_usd: (s.cost_usd as number | string | null) ?? null,
        thumbs: (s.thumbs as Record<string, unknown> | null) ?? null,
        facts_viewport_width: typeof facts?.viewport?.width === 'number' ? facts.viewport.width : null,
      }
    })
    .sort((x, y) => (order.get(x.run_id) ?? 0) - (order.get(y.run_id) ?? 0))
  const picks = pickBaselineCaptures(rows, projectId, input.only)
  if (!picks.length) {
    return { ok: false, code: 'NO_CAPTURES', message: 'The latest runs kept no screenshots (they may be past the capture retention). Run the scorecard again, then pin.' }
  }

  const { data: existing } = await db.from('ux_baselines').select('surface_key, viewport, capture_path').eq('project_id', projectId).eq('version', version)
  const prior = new Map(((existing ?? []) as Array<{ surface_key: string; viewport: string; capture_path: string }>).map((b) => [`${b.surface_key}|${b.viewport}`, b.capture_path]))
  let pinned = 0
  let failed = 0
  const now = new Date().toISOString()
  const queue = [...picks]
  const work = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const dest = baselineCapturePath(projectId, p.surfaceKey, p.viewport, version, p.runId, p.ext)
      const old = prior.get(`${p.surfaceKey}|${p.viewport}`)
      if (old !== dest) {
        const { error: cpErr } = await db.storage.from(UX_CAPTURES_BUCKET).copy(p.sourcePath, dest)
        if (cpErr && !/exist/i.test(cpErr.message)) {
          failed++
          plog.warn('baseline copy failed', { projectId, surface: p.surfaceKey, err: cpErr.message.slice(0, 200) })
          continue
        }
      }
      const { error: upErr } = await db.from('ux_baselines').upsert(
        {
          project_id: projectId,
          surface_key: p.surfaceKey,
          path: p.path,
          label: p.label,
          viewport: p.viewport,
          release_id: releaseId,
          version,
          run_id: p.runId,
          capture_path: dest,
          capture_hash: p.captureHash,
          score: p.score,
          penalty: p.penalty,
          cost_usd: p.costUsd,
          created_by: input.userId,
          created_at: now,
        },
        { onConflict: 'project_id,surface_key,viewport,version' },
      )
      if (upErr) {
        failed++
        await db.storage.from(UX_CAPTURES_BUCKET).remove([dest]).catch(() => null)
        continue
      }
      if (old && old !== dest) await db.storage.from(UX_CAPTURES_BUCKET).remove([old]).catch(() => null)
      pinned++
    }
  }
  await Promise.all(Array.from({ length: COPY_CONCURRENCY }, work))
  return { ok: true, pinned, failed, screens: new Set(picks.map((p) => p.surfaceKey)).size }
}

export interface AutoPinRelease {
  id: string
  project_id: string
  version: string
}

/**
 * ADR 0072: after a release is published, pin the current screens to it when
 * the app opted in (`project_settings.ux_baseline_auto_pin`, default off).
 * Best effort: it never fails the publish, and logs what it did.
 */
export async function autoPinOnPublish(
  db: SupabaseClient,
  release: AutoPinRelease,
  pin: (db: SupabaseClient, input: PinInput) => Promise<PinOutcome> = pinBaselines,
): Promise<{ pinned: number; skipped?: 'off' | 'no_captures' | 'error' }> {
  try {
    const { data, error } = await db.from('project_settings').select('ux_baseline_auto_pin').eq('project_id', release.project_id).maybeSingle()
    if (error) {
      plog.warn('auto-pin setting unreadable', { projectId: release.project_id, err: error.message })
      return { pinned: 0, skipped: 'error' }
    }
    if ((data as { ux_baseline_auto_pin?: boolean } | null)?.ux_baseline_auto_pin !== true) return { pinned: 0, skipped: 'off' }
    const out = await pin(db, { projectId: release.project_id, version: release.version, releaseId: release.id, userId: null })
    if (!out.ok) {
      if (out.code === 'DB_ERROR') plog.warn('auto-pin failed', { projectId: release.project_id, releaseId: release.id, err: out.message })
      return { pinned: 0, skipped: out.code === 'NO_CAPTURES' ? 'no_captures' : 'error' }
    }
    plog.info('auto-pinned release screens', { projectId: release.project_id, releaseId: release.id, pinned: out.pinned, failed: out.failed })
    return { pinned: out.pinned }
  } catch (err) {
    plog.warn('auto-pin threw', { projectId: release.project_id, err: String(err).slice(0, 200) })
    return { pinned: 0, skipped: 'error' }
  }
}
