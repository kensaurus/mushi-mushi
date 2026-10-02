/**
 * FILE: reporter-thread.ts
 * PURPOSE: Loading rules for the RN "Your reports" thread (Plan 018 §2.3).
 *
 * OVERVIEW:
 * - Every load settles: comments, or `null` on an API failure, a throw, or a
 *   request that never answers (a host fetch wrapper that hangs). The sheet
 *   turns `null` into "Couldn't load updates · Retry", so a skeleton can not
 *   stay on screen forever.
 * - `markReporterReportRead` clears a report's badge through the existing
 *   notification routes, matched on `payload.reportId`.
 */

import type { MushiApiClient, MushiReporterComment } from '@mushi-mushi/core'

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

type NotificationClient = Pick<MushiApiClient, 'listNotifications' | 'markNotificationRead'>

/** Mark the reporter's unread notifications for one report read. Resolves the count marked; never throws. */
export async function markReporterReportRead(
  client: NotificationClient,
  reporterToken: string,
  reportId: string,
): Promise<number> {
  try {
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
