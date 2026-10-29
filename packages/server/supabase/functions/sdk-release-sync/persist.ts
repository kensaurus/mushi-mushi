/**
 * FILE: packages/server/supabase/functions/sdk-release-sync/persist.ts
 * PURPOSE: Retry a transient gateway failure while saving an SDK release sync.
 *
 * OVERVIEW:
 * The cron's persist step is one update of sdk_upgrade_jobs. PostgREST sits
 * behind Cloudflare, so a single 502/503/504 used to become SYNC_PERSIST_FAILED
 * and a Sentry error, and the row stayed stale until the next tick
 * (Mushi report 547db71b).
 *
 * DEPENDENCIES:
 * - _shared/sdk-release-sync.ts — the GitHub read and the one update
 * - _shared/error-codes.ts — gateway HTML / 502 classification
 * - _shared/logger.ts — warn on a blip, error only for a real database failure
 *
 * USAGE:
 * Called only from sdk-release-sync/index.ts. Not imported by `api`
 * (that bundle is at its upload-size budget).
 *
 * NOTES:
 * A retry runs the whole sync again. The update is the same job row, so a
 * write that landed and then returned 502 is safe to repeat. The gateway
 * page is never logged: the status title and cf-ray are.
 */

import type { getServiceClient } from '../_shared/db.ts'
import { dbDiagnosticMessage, isTransientDbConnectionError } from '../_shared/error-codes.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { syncSdkReleaseJob, type SdkReleaseJob } from '../_shared/sdk-release-sync.ts'

const log = rootLog.child('sdk-release-sync')

/** One try plus two retries. 100ms then 200ms — a tick handles up to 50 jobs. */
const PERSIST_ATTEMPTS = 3

function cloudflareRayId(text: string): string | null {
  const ray = text.match(/cloudflare ray id:\s*(?:<[^>]*>\s*)*([0-9a-f]{8,32}(?:-[A-Za-z0-9]+)?)/i)
    ?? text.match(/\bcf-ray\b[^A-Za-z0-9]*([0-9a-f]{8,32}(?:-[A-Za-z0-9]+)?)/i)
  return ray?.[1] ?? null
}

function gatewayStatus(text: string): string | null {
  return text.match(/\b(502|503|504|52[0-4])\b/)?.[1] ?? null
}

function plainPersistMessage(message: string, transient: boolean): string {
  if (!transient) return dbDiagnosticMessage(message).slice(0, 300)
  const http = gatewayStatus(message)
  return `Could not save the CI status${http ? ` (HTTP ${http})` : ''}. Retry in a moment.`
}

/** Gateway HTML, a 502/503/504 title, or a dropped socket. A coded SQL error is not this. */
function isRetryablePersistMessage(message: string): boolean {
  if (isTransientDbConnectionError({ message })) return true
  return /fetch failed|econnreset|socket hang up|^timed out$/i.test(message)
}

/** A thrown write. A coded query error is returned by the client, not thrown. */
function thrownPersistMessage(err: unknown): string | null {
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof Error && err.name === 'TimeoutError') return 'timed out'
  return isRetryablePersistMessage(message) ? message : null
}

/**
 * Read GitHub and store the result. A transient persist failure (Cloudflare
 * 502/503/504, or a dropped connection whose text we already classify) is
 * tried up to three times. A coded database error is not retried.
 */
export async function syncSdkReleaseJobRetryingPersist(
  db: ReturnType<typeof getServiceClient>,
  token: string,
  job: SdkReleaseJob,
  opts: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<Awaited<ReturnType<typeof syncSdkReleaseJob>>> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const once = async () => {
    try {
      return await syncSdkReleaseJob(db, token, job)
    } catch (err) {
      const message = thrownPersistMessage(err)
      if (message === null) throw err
      return { ok: false as const, code: 'SYNC_PERSIST_FAILED' as const, message }
    }
  }
  let result = await once()
  for (let attempt = 0; attempt < PERSIST_ATTEMPTS - 1; attempt++) {
    if (result.ok || result.code !== 'SYNC_PERSIST_FAILED') return result
    const message = result.message ?? ''
    if (!isRetryablePersistMessage(message)) break
    const cfRay = cloudflareRayId(message)
    log.warn('retrying sdk release persist', {
      jobId: job.id,
      attempt: attempt + 1,
      attempts: PERSIST_ATTEMPTS,
      ...(cfRay ? { cfRay } : {}),
      detail: dbDiagnosticMessage(message).slice(0, 300),
      transient: true,
    })
    await sleep(100 * 2 ** attempt)
    result = await once()
  }
  if (result.ok || result.code !== 'SYNC_PERSIST_FAILED') return result
  const message = result.message ?? ''
  const transient = isRetryablePersistMessage(message)
  const detail = dbDiagnosticMessage(message).slice(0, 300)
  const cfRay = cloudflareRayId(message)
  if (transient) {
    log.warn('failed to persist sync', {
      jobId: job.id,
      detail,
      ...(cfRay ? { cfRay } : {}),
      transient: true,
    })
  } else {
    log.error('failed to persist sync', { jobId: job.id, err: detail })
  }
  return { ...result, message: plainPersistMessage(message, transient) }
}
