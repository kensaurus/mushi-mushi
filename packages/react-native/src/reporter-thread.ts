/**
 * FILE: reporter-thread.ts
 * PURPOSE: Loading rules for the RN "Your reports" thread (Plan 018 §2.3).
 *
 * OVERVIEW:
 * - Every load settles: comments, or `null` on an API failure, a throw, or a
 *   request that never answers (a host fetch wrapper that hangs). The sheet
 *   turns `null` into "Couldn't load updates · Retry", so a skeleton can not
 *   stay on screen forever.
 * - `markReporterReportRead` clears a report's badge with one call to
 *   `POST /v1/reporter/reports/:id/read` (which also covers a canonical report
 *   the reporter follows). A server without that route (404) falls back to
 *   the per-notification routes, matched on `payload.reportId`.
 */

import type { MushiApiClient, MushiReporterComment } from '@mushi-mushi/core'
import { reporterChannels, type MushiReporterUpdates } from '@mushi-mushi/core/reporter-channels'

/** A thread request that has not answered by now is treated as failed. */
export const THREAD_LOAD_TIMEOUT_MS = 12_000

/** Resolve `p`, or `null` once `ms` passes or `p` rejects. */
export function settleWithin<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    p.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
    )
  })
}

/** Load a thread; `null` means show Retry. */
export function loadReporterThread(
  load: (reportId: string) => Promise<MushiReporterComment[] | null>,
  reportId: string,
  timeoutMs: number = THREAD_LOAD_TIMEOUT_MS,
): Promise<MushiReporterComment[] | null> {
  let started: Promise<MushiReporterComment[] | null>
  try {
    started = load(reportId)
  } catch {
    return Promise.resolve(null)
  }
  return settleWithin(started, timeoutMs)
}

type NotificationClient = Pick<MushiApiClient, 'listNotifications' | 'markNotificationRead' | 'reporterRequest'>

/** Mark the reporter's unread notifications for one report read. Resolves the count marked; never throws. */
export async function markReporterReportRead(
  client: NotificationClient,
  reporterToken: string,
  reportId: string,
): Promise<number> {
  try {
    const v2 = await reporterChannels(client).markReportRead(reportId, reporterToken)
    if (v2.ok) return v2.data?.marked_read ?? 0
    if (v2.error?.status !== 404) return 0
    const res = await client.listNotifications(reporterToken, { limit: 100 })
    if (!res.ok) return 0
    const rows = (res.data as { notifications?: Array<Record<string, unknown>> } | undefined)?.notifications ?? []
    const ids = rows
      .filter((n) => !n.read_at && (n.payload as { reportId?: unknown } | null)?.reportId === reportId)
      .map((n) => String(n.id))
    let marked = 0
    for (const id of ids) {
      const r = await client.markNotificationRead(id, reporterToken)
      if (r.ok) marked++
    }
    return marked
  } catch {
    return 0
  }
}

export interface ReporterUpdateHub {
  /** Add a listener; it gets the current updates right away. Returns unsubscribe. */
  subscribe(cb: (updates: MushiReporterUpdates) => void): () => void
  /** Fetch now and hand the result to every listener; null on any failure. */
  emit(): Promise<MushiReporterUpdates | null>
  listenerCount(): number
}

/**
 * Host badges (`onReporterUpdate`). Never throws: a failed fetch resolves
 * null and a listener that throws is skipped, so a host bug can not break
 * the SDK or the other listeners.
 */
export function createReporterUpdateHub(fetchUpdates: () => Promise<MushiReporterUpdates | null>): ReporterUpdateHub {
  const listeners = new Set<(updates: MushiReporterUpdates) => void>()
  async function emit(): Promise<MushiReporterUpdates | null> {
    let updates: MushiReporterUpdates | null = null
    try {
      updates = await fetchUpdates()
    } catch {
      return null
    }
    if (updates) {
      for (const cb of listeners) {
        try {
          cb(updates)
        } catch {
          /* host bug */
        }
      }
    }
    return updates
  }
  return {
    subscribe(cb) {
      listeners.add(cb)
      void emit()
      return () => {
        listeners.delete(cb)
      }
    },
    emit,
    listenerCount: () => listeners.size,
  }
}
