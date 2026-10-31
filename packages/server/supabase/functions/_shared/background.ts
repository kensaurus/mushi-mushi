/**
 * FILE: packages/server/supabase/functions/_shared/background.ts
 * PURPOSE: Keep fire-and-forget work alive after the response is sent.
 *
 * Supabase Edge Functions may shut an isolate down once the handler's
 * response is out. A bare `void promise` that is still waiting on the
 * database at that moment is dropped without an error anywhere. The runtime's
 * documented escape hatch is `EdgeRuntime.waitUntil(promise)`, which several
 * routes already call inline (fix-dispatch, project-codebase, classify-report).
 * This module is that call in one place, so an emit that must land (company
 * funnel milestones, end-user linkage, operator alerts) cannot be forgotten
 * one call site at a time.
 *
 * Outside the Edge runtime (vitest, `deno test`, local scripts) there is no
 * `EdgeRuntime` global and both helpers degrade to plain fire-and-forget.
 */

import { log } from './logger.ts'

interface EdgeRuntimeLike {
  waitUntil(promise: Promise<unknown>): void
}

function edgeRuntime(): EdgeRuntimeLike | null {
  const rt = (globalThis as { EdgeRuntime?: Partial<EdgeRuntimeLike> }).EdgeRuntime
  return rt && typeof rt.waitUntil === 'function' ? (rt as EdgeRuntimeLike) : null
}

/**
 * Register `promise` with the runtime so the isolate stays up until it
 * settles, and hand the same promise back unchanged. For helpers whose
 * callers may either await the result or drop it (`emitProductEvent`).
 */
export function keepAlive<T>(promise: Promise<T>): Promise<T> {
  const rt = edgeRuntime()
  if (rt) {
    try {
      // The copy handed to the runtime swallows rejections: the caller still
      // sees them on the returned promise, the runtime never logs them twice.
      rt.waitUntil(promise.catch(() => undefined))
    } catch {
      // waitUntil throws when called outside a request context in some
      // runtime versions; the work itself still runs.
    }
  }
  return promise
}

/**
 * Keep a warm isolate for the next request (2026-10-31).
 *
 * The hosted runtime retires an isolate as soon as it is idle (shutdown
 * reason `EarlyDrop`): response sent, no `waitUntil` work pending. Prod logs
 * showed 45% of console requests on `api` booting a fresh isolate (p50 1.06 s
 * cold vs 0.47 s warm), because a person's next click rarely lands while the
 * previous isolate is still busy. One pending timer per isolate, pushed back
 * by every request, keeps it up for `graceMs` after the last one. It stops
 * extending once the isolate is `maxAgeMs` old, well inside the 150 s / 400 s
 * wall-clock limit, so an isolate is never killed mid-request by the hold.
 */
export function createWarmHold(opts: {
  graceMs: number
  maxAgeMs: number
  now?: () => number
  hold?: (promise: Promise<unknown>) => void
}): () => void {
  const now = opts.now ?? Date.now
  const hold = opts.hold ?? ((p: Promise<unknown>) => void keepAlive(p))
  const startedAt = now()
  let until = 0
  let pending = false
  return () => {
    const deadline = Math.min(now() + opts.graceMs, startedAt + opts.maxAgeMs)
    if (deadline <= now()) return
    until = Math.max(until, deadline)
    if (pending) return
    pending = true
    hold(
      new Promise<void>((resolve) => {
        const wait = () => {
          const left = until - now()
          if (left > 0) {
            setTimeout(wait, left)
          } else {
            pending = false
            resolve()
          }
        }
        wait()
      }),
    )
  }
}

/** The console-facing functions' hold: 30 s after the last request, at most 2 min per isolate. */
export const holdWarm = createWarmHold({ graceMs: 30_000, maxAgeMs: 120_000 })

/**
 * Run `task` in the background: kept alive past the response, and a rejection
 * is logged instead of surfacing as an unhandled promise rejection.
 */
export function runInBackground(task: Promise<unknown>, label: string): void {
  keepAlive(
    task.catch((err: unknown) => {
      log.warn('background task failed', {
        task: label,
        err: err instanceof Error ? err.message : String(err),
      })
    }),
  )
}
