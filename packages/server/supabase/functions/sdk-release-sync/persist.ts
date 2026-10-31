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
 * - _shared/logger.ts — warn while retrying; error once every attempt fails
 *
 * USAGE:
 * Called only from sdk-release-sync/index.ts. Not imported by `api`
 * (that bundle is at its upload-size budget).
 *
 * NOTES:
 * GitHub is read once. A retry writes the same job row again, so a write
 * that landed and then returned 502 is safe to repeat. Only that write is
 * classified as SYNC_PERSIST_FAILED. The gateway page is never logged:
 * the status title and cf-ray are.
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

/** The one row write. A thrown gateway/socket error becomes its message; anything else is rethrown. */
async function writeSdkReleaseRow(
  db: ReturnType<typeof getServiceClient>,
  jobId: string,
  update: Record<string, unknown>,
): Promise<string | null> {
  try {
    const { error } = await db.from('sdk_upgrade_jobs').update(update).eq('id', jobId)
    return error ? error.message ?? '' : null
  } catch (err) {
    const message = thrownPersistMessage(err)
    if (message === null) throw err
    return message
  }
}

/**
 * Read GitHub once and store the result. A transient failure of the row write
 * (Cloudflare 502/503/504, or a dropped connection whose text we already
 * classify) is tried up to three times. A coded database error is not retried.
 * A throw from the GitHub read is not this failure.
 */
export async function syncSdkReleaseJobRetryingPersist(
  db: ReturnType<typeof getServiceClient>,
  token: string,
  job: SdkReleaseJob,
  opts: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<Awaited<ReturnType<typeof syncSdkReleaseJob>>> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  return syncSdkReleaseJob(db, token, job, {
    persist: async (update) => {
      const row = update as Record<string, unknown>
      let failed = await writeSdkReleaseRow(db, job.id, row)
      for (let attempt = 0; attempt < PERSIST_ATTEMPTS - 1; attempt++) {
        if (failed == null || !isRetryablePersistMessage(failed)) break
        const cfRay = cloudflareRayId(failed)
        log.warn('retrying sdk release persist', {
          jobId: job.id,
          attempt: attempt + 1,
          attempts: PERSIST_ATTEMPTS,
          ...(cfRay ? { cfRay } : {}),
          detail: dbDiagnosticMessage(failed).slice(0, 300),
          transient: true,
        })
        await sleep(100 * 2 ** attempt)
        failed = await writeSdkReleaseRow(db, job.id, row)
      }
      if (failed == null) return null
      const transient = isRetryablePersistMessage(failed)
      const detail = dbDiagnosticMessage(failed).slice(0, 300)
      const cfRay = cloudflareRayId(failed)
      // A blip that recovers is a warning above. Every attempt failing is an
      // error so a lasting gateway outage still reaches Sentry.
      if (transient) {
        log.error('failed to persist sync', {
          jobId: job.id,
          detail,
          ...(cfRay ? { cfRay } : {}),
          transient: true,
        })
      } else {
        log.error('failed to persist sync', { jobId: job.id, err: detail })
      }
      return plainPersistMessage(failed, transient)
    },
  })
}
