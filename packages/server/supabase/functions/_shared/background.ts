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
