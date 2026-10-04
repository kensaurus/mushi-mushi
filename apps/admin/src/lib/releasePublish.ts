/**
 * FILE: apps/admin/src/lib/releasePublish.ts
 * PURPOSE: Publish a release draft and say truthfully what happened.
 *
 * The publish route answers `{ ok, data, notified, tickets_fulfilled,
 * delivery }`. apiFetch keeps only `data`, so the console read `delivery`
 * as undefined and always toasted "0 reporters told it shipped", and never
 * showed delivery failures. This reads the whole body. A release that went
 * live but whose follow-ups failed (`published: true` on an error) is
 * reported as live, not as a failed publish.
 */

import { coerceApiResult } from './apiEnvelope'
import { apiErrorText } from './apiErrorText'
import { apiFetchRaw } from './supabase'

interface ReleaseDelivery {
  reporters_notified?: number
  reporters_held?: number
  reporters_failed?: number
  reports_already_released?: number
}

export type PublishOutcome =
  | {
      kind: 'published'
      told: number
      held: number
      failed: number
      alreadyShipped: number
    }
  /** Live, but linking tickets or messaging reporters partly failed. */
  | { kind: 'published-with-errors'; message: string }
  | { kind: 'failed'; message: string }

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0)

export function readPublishResponse(body: unknown): PublishOutcome {
  const result = coerceApiResult<unknown>(body)
  const raw = (body && typeof body === 'object' ? body : {}) as { published?: unknown; delivery?: ReleaseDelivery }
  if (!result.ok) {
    const message = apiErrorText(result.error, 'The release could not be published. Try again in a moment.')
    return raw.published === true ? { kind: 'published-with-errors', message } : { kind: 'failed', message }
  }
  const d = raw.delivery ?? {}
  return {
    kind: 'published',
    told: count(d.reporters_notified),
    held: count(d.reporters_held),
    failed: count(d.reporters_failed),
    alreadyShipped: count(d.reports_already_released),
  }
}

export async function publishReleaseRequest(releaseId: string): Promise<PublishOutcome> {
  let res: Response
  try {
    res = await apiFetchRaw(`/v1/admin/releases/${releaseId}/publish`, { method: 'POST' })
  } catch {
    return { kind: 'failed', message: 'Could not reach the server. Check your connection and try again.' }
  }
  const body = await res.json().catch(() => null)
  if (!body) {
    return { kind: 'failed', message: 'The server returned an unexpected answer. Refresh to check whether the release went out.' }
  }
  return readPublishResponse(body)
}
